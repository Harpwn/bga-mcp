/**
 * MCP Resources — exposes pre-crawled BGA Studio wiki pages as readable
 * resources so AI clients can attach them directly to context.
 *
 * Docs are crawled automatically on first startup, or run `npm run crawl`
 * to refresh them manually.
 */

import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BGA_DOC_PAGES, BGA_WIKI_API, BGA_WIKI_TIMEOUT_MS } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// docs/ lives at project root, one level above dist/ (where this compiles to)
export const DOCS_DIR = path.resolve(__dirname, "..", "docs");

export const RESOURCE_URI_PREFIX = "bga-docs://";

export interface BgaResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * Returns the list of available resources.
 * Only includes pages that have been crawled (file exists in docs/).
 * Falls back to listing all configured pages with a "not crawled" note if
 * docs/ is missing entirely (so the server still starts cleanly).
 */
export function listResources(): BgaResource[] {
  const docsExist = fs.existsSync(DOCS_DIR);

  return BGA_DOC_PAGES.map((entry) => {
    const filePath = path.join(DOCS_DIR, `${entry.alias}.md`);
    const crawled = docsExist && fs.existsSync(filePath);

    return {
      uri: `${RESOURCE_URI_PREFIX}${entry.alias}`,
      name: `BGA Docs: ${entry.alias}`,
      description: crawled
        ? entry.description
        : `[Not yet crawled — run \`npm run crawl\`] ${entry.description}`,
      mimeType: "text/markdown",
    };
  });
}

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------

async function fetchWikiPage(wikiPage: string): Promise<string | null> {
  const response = await axios.get(BGA_WIKI_API, {
    params: {
      action: "query",
      titles: wikiPage,
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      format: "json",
      origin: "*",
      formatversion: "2",
    },
    timeout: BGA_WIKI_TIMEOUT_MS,
  });

  const pages = response.data?.query?.pages ?? [];
  if (!pages.length || pages[0].missing) return null;

  return (
    pages[0].revisions?.[0]?.slots?.main?.content ??
    pages[0].revisions?.[0]?.content ??
    null
  );
}

/**
 * Fetch all configured BGA wiki pages and write them to DOCS_DIR.
 * Logs progress to stderr so it doesn't interfere with MCP stdio transport.
 */
export async function crawlAllPages(): Promise<{ ok: number; fail: number }> {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  let ok = 0;
  let fail = 0;

  for (const entry of BGA_DOC_PAGES) {
    try {
      const content = await fetchWikiPage(entry.wikiPage);
      if (!content) {
        console.error(`  [crawl] ${entry.alias}: not found on wiki`);
        fail++;
        continue;
      }

      const header = [
        `# ${entry.alias}`,
        ``,
        `> **Category:** ${entry.category}`,
        `> **Wiki page:** https://en.doc.boardgamearena.com/${entry.wikiPage.replace(/ /g, "_")}`,
        ``,
        `## Summary`,
        ``,
        entry.description,
        ``,
        `---`,
        ``,
        `## Full Content`,
        ``,
      ].join("\n");

      const filePath = path.join(DOCS_DIR, `${entry.alias}.md`);
      fs.writeFileSync(filePath, header + content, "utf-8");
      console.error(`  [crawl] ${entry.alias}: ok`);
      ok++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [crawl] ${entry.alias}: error — ${msg}`);
      fail++;
    }
  }

  // Write index
  const index = BGA_DOC_PAGES.map(
    (p) => `- [${p.alias}](${p.alias}.md) — ${p.description}`
  ).join("\n");
  fs.writeFileSync(
    path.join(DOCS_DIR, "README.md"),
    `# BGA Studio Documentation\n\nCrawled from https://en.doc.boardgamearena.com/\n\n${index}\n`,
    "utf-8"
  );

  return { ok, fail };
}

/**
 * Crawl only if docs/ is missing or empty (no .md files present).
 * Safe to call on every startup — no-ops if already crawled.
 */
export async function ensureDocs(): Promise<void> {
  const hasDocs =
    fs.existsSync(DOCS_DIR) &&
    fs.readdirSync(DOCS_DIR).some((f) => f.endsWith(".md") && f !== "README.md");

  if (hasDocs) return;

  console.error("[bga-mcp] docs/ not found or empty — crawling BGA wiki (this runs once)...");
  const { ok, fail } = await crawlAllPages();
  console.error(`[bga-mcp] crawl complete: ${ok} ok, ${fail} failed.`);
}

// ---------------------------------------------------------------------------

/**
 * Reads a single resource by URI (e.g. "bga-docs://debugging").
 * Returns null if the alias is unknown or the file hasn't been crawled yet.
 */
export function readResource(uri: string): string | null {
  if (!uri.startsWith(RESOURCE_URI_PREFIX)) return null;

  const alias = uri.slice(RESOURCE_URI_PREFIX.length);
  const entry = BGA_DOC_PAGES.find((p) => p.alias === alias);
  if (!entry) return null;

  const filePath = path.join(DOCS_DIR, `${alias}.md`);
  if (!fs.existsSync(filePath)) {
    return (
      `# ${alias} — Not Yet Crawled\n\n` +
      `Run \`npm run crawl\` to fetch this page from the BGA Studio wiki.\n\n` +
      `**Description:** ${entry.description}\n\n` +
      `**Wiki URL:** https://en.doc.boardgamearena.com/${entry.wikiPage.replace(/ /g, "_")}`
    );
  }

  return fs.readFileSync(filePath, "utf-8");
}
