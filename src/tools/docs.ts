import axios from "axios";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { BGA_DOC_PAGES, BGA_WIKI_API, BGA_WIKI_TIMEOUT_MS, type DocPage } from "../config.js";

export { BGA_DOC_PAGES };

const PAGE_BY_ALIAS = new Map(BGA_DOC_PAGES.map((p) => [p.alias, p]));

// ---------------------------------------------------------------------------

export const docTools: Tool[] = [
  {
    name: "bga_list_doc_pages",
    description:
      "List all curated BGA Studio documentation pages available to fetch, grouped by category.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "bga_get_doc_page",
    description:
      "Fetch the full content of a BGA Studio wiki page. Provide either an alias from bga_list_doc_pages or a raw wiki page name.",
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "string",
          description:
            "Alias from the catalog (e.g. 'game_states', 'notifications') or a raw wiki page name (e.g. 'Your_game_state_machine').",
        },
      },
      required: ["page"],
    },
  },
];

export async function handleDocTool(
  name: string,
  args: Record<string, unknown>
) {
  if (name === "bga_list_doc_pages") {
    return listDocPages();
  }
  if (name === "bga_get_doc_page") {
    const input = args.page as string;
    // Resolve alias â†’ wiki page name, or fall through to raw page name
    const entry = PAGE_BY_ALIAS.get(input);
    return getBGADocPage(entry?.wikiPage ?? input, entry);
  }
  return { content: [{ type: "text", text: `Unknown doc tool: ${name}` }], isError: true };
}

function listDocPages() {
  const byCategory = new Map<string, DocPage[]>();
  for (const p of BGA_DOC_PAGES) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category)!.push(p);
  }
  const sections = [...byCategory.entries()].map(([cat, pages]) => {
    const rows = pages
      .map((p) => `  - \`${p.alias}\` â€” ${p.description}`)
      .join("\n");
    return `### ${cat}\n${rows}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `## BGA Documentation Pages\n\nPass any alias to \`bga_get_doc_page\`.\n\n${sections.join("\n\n")}`,
      },
    ],
  };
}

async function getBGADocPage(page: string, entry?: DocPage) {
  const label = entry ? `${entry.description} (${entry.alias})` : page;
  try {
    const response = await axios.get(BGA_WIKI_API, {
      params: {
        action: "query",
        titles: page,
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
    if (!pages.length || pages[0].missing) {
      return {
        content: [
          {
            type: "text",
            text: `Page "${page}" not found on the BGA Studio wiki.\n\nUse \`bga_list_doc_pages\` to see available pages.`,
          },
        ],
      };
    }

    const content =
      pages[0].revisions?.[0]?.slots?.main?.content ??
      pages[0].revisions?.[0]?.content ??
      "(no content)";

    if (/^\s*this (page|file) is deprecated/i.test(content)) {
      return {
        content: [
          {
            type: "text",
            text: `Page "${label}" is marked as deprecated on the BGA Studio wiki and has been skipped.\n\nUse \`bga_list_doc_pages\` to find an up-to-date alternative.`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `## BGA Wiki: ${label}\n\nhttps://en.doc.boardgamearena.com/${page.replace(/ /g, "_")}\n\n${content}`,
        },
      ],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [
        { type: "text", text: `Error fetching BGA wiki page "${label}": ${msg}` },
      ],
      isError: true,
    };
  }
}