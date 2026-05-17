import fs from "fs";
import path from "path";
import { createRequire } from "module";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { WORKSPACE_PATH } from "../config.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buf: Buffer, opts?: { max?: number }) => Promise<{ text: string; numpages: number }> =
  require("pdf-parse");

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type SectionKey = "gameplay" | "pilgrim" | "artist" | "merchant" | "end-game";

interface SectionDef {
  key: SectionKey;
  title: string;
  headingMatchers: RegExp[];
}

const SECTION_DEFS: SectionDef[] = [
  {
    key: "gameplay",
    title: "Gameplay",
    headingMatchers: [/^gameplay\b/i],
  },
  {
    key: "pilgrim",
    title: "The Pilgrim",
    headingMatchers: [/^the\s+pilgrim\b/i, /^pilgrim\b/i],
  },
  {
    key: "artist",
    title: "The Artist",
    headingMatchers: [/^the\s+artist\b/i, /^artist\b/i],
  },
  {
    key: "merchant",
    title: "The Merchant",
    headingMatchers: [/^the\s+merchant\b/i, /^merchant\b/i],
  },
  {
    key: "end-game",
    title: "End Game",
    headingMatchers: [/^end\s*game\b/i, /^end\s+of\s+game\b/i],
  },
];

const RULEBOOK_EXTENSIONS = [".pdf", ".txt", ".md"];

const projectPathProp = {
  type: "string",
  description: "Absolute path to the BGA game project root. Overrides gameName when provided.",
};

const gameNameProp = {
  type: "string",
  description: WORKSPACE_PATH
    ? "Name of the game subfolder inside the workspace. Auto-selected when only one game is present. Use bga_list_games to discover options."
    : "Name of the game subfolder within the games workspace directory.",
};

export const testStubTools: Tool[] = [
  {
    name: "bga_generate_rulebook_test_stubs",
    description:
      "Generate deterministic Vitest rulebook TDD stubs split by major section files (<game>.<section>.test.ts). " +
      "Reads a local rulebook (.pdf/.txt/.md), creates TODO test stubs, and reports coverage by section.",
    inputSchema: {
      type: "object",
      properties: {
        gameName: gameNameProp,
        projectPath: projectPathProp,
        filePath: {
          type: "string",
          description: "Rulebook filename at project root (auto-detected if omitted).",
        },
        outputDir: {
          type: "string",
          description: "Output directory for tests. Absolute or project-relative (default: test/integration).",
        },
        filenamePattern: {
          type: "string",
          description:
            "Filename pattern with <game> and <section> placeholders (default: <game>.<section>.test.ts).",
        },
        maxPages: {
          type: "number",
          description: "Maximum pages to parse when reading a PDF rulebook (default: all pages).",
        },
        overwrite: {
          type: "boolean",
          description: "Overwrite existing files when true (default: false).",
        },
        dryRun: {
          type: "boolean",
          description: "If true, only report planned files and counts without writing files.",
        },
      },
      required: [],
    },
  },
];

export async function handleTestStubTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (name !== "bga_generate_rulebook_test_stubs") {
    return {
      content: [{ type: "text", text: `Unknown test-stub tool: ${name}` }],
      isError: true,
    };
  }

  return generateRulebookTestStubs(args);
}

function discoverGames(workspacePath: string): string[] {
  try {
    return fs
      .readdirSync(workspacePath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => {
        try {
          const files = fs.readdirSync(path.join(workspacePath, name));
          return files.some((f) => f.endsWith(".game.php")) || files.includes("states.inc.php");
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function resolveProjectPath(
  args: Record<string, unknown>
): { resolved: string; gameName: string } | { resolved: null; gameName: null } {
  if (args.projectPath) {
    const p = args.projectPath as string;
    return { resolved: p, gameName: path.basename(p) };
  }
  if (!WORKSPACE_PATH) return { resolved: null, gameName: null };
  if (args.gameName) {
    const g = args.gameName as string;
    return { resolved: path.join(WORKSPACE_PATH, g), gameName: g };
  }

  const games = discoverGames(WORKSPACE_PATH);
  if (games.length === 1) {
    return { resolved: path.join(WORKSPACE_PATH, games[0]), gameName: games[0] };
  }
  return { resolved: null, gameName: null };
}

function noProjectPathError(multipleGames: boolean): ToolResponse {
  const text = multipleGames
    ? "Multiple BGA games found in the workspace. Pass a gameName argument (use bga_list_games to see options)."
    : "No projectPath or gameName provided and no detectable workspace game. Please supply one.";
  return { content: [{ type: "text", text }], isError: true };
}

function findRulebooks(projectPath: string): string[] {
  try {
    return fs
      .readdirSync(projectPath, { withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() &&
          RULEBOOK_EXTENSIONS.some((ext) => e.name.toLowerCase().endsWith(ext)) &&
          e.name.toLowerCase().includes("rules")
      )
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function readRulebookText(
  projectPath: string,
  filePath: string | undefined,
  maxPages: number | undefined
): Promise<{ fileName: string; text: string } | { error: string }> {
  let target = filePath;
  if (!target) {
    const found = findRulebooks(projectPath);
    if (found.length === 0) {
      return {
        error:
          "No rulebook file found at project root. Expected a file containing 'rules' with extension .pdf, .txt, or .md.",
      };
    }
    target = found[0];
  }

  const absPath = path.isAbsolute(target) ? target : path.join(projectPath, target);
  if (!fs.existsSync(absPath)) {
    return { error: `Rulebook file not found: ${target}` };
  }

  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".txt" || ext === ".md") {
    const raw = fs.readFileSync(absPath, "utf-8");
    return { fileName: path.basename(absPath), text: raw };
  }

  if (ext === ".pdf") {
    const buffer = fs.readFileSync(absPath);
    const parsed = await pdfParse(buffer, maxPages ? { max: maxPages } : undefined);
    return { fileName: path.basename(absPath), text: parsed.text ?? "" };
  }

  return {
    error: `Unsupported rulebook extension: ${ext}. Supported: ${RULEBOOK_EXTENSIONS.join(", ")}`,
  };
}

function detectSectionHeading(line: string): SectionDef | null {
  const trimmed = line.trim();
  for (const section of SECTION_DEFS) {
    if (section.headingMatchers.some((rx) => rx.test(trimmed))) {
      return section;
    }
  }
  return null;
}

function cleanLine(line: string): string {
  return line
    .replace(/^[\-\*•]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAtomic(line: string): string[] {
  const normalized = cleanLine(line).replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chunks = normalized
    .split(/[;]+/)
    .flatMap((part) => part.split(/(?<=[.!?])\s+/))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const atomic: string[] = [];
  for (const chunk of chunks) {
    const isCompound = /\s+and\s+|\s+or\s+/i.test(chunk) && chunk.split(" ").length > 10;
    if (!isCompound) {
      atomic.push(chunk);
      continue;
    }

    const pieces = chunk
      .split(/\s+(?:and|or)\s+/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (pieces.length <= 1) {
      atomic.push(chunk);
      continue;
    }

    atomic.push(...pieces);
  }

  return atomic;
}

function toTestTitle(sentence: string): string {
  const noPunct = sentence.replace(/[\.!?]+$/g, "").trim();
  const lowerFirst = noPunct.length > 1
    ? `${noPunct.charAt(0).toLowerCase()}${noPunct.slice(1)}`
    : noPunct.toLowerCase();
  return lowerFirst || "rule sentence is covered";
}

function buildSectionSentences(rulebookText: string): Record<SectionKey, string[]> {
  const grouped: Record<SectionKey, string[]> = {
    gameplay: [],
    pilgrim: [],
    artist: [],
    merchant: [],
    "end-game": [],
  };

  let current: SectionKey = "gameplay";
  const lines = rulebookText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line) continue;

    const heading = detectSectionHeading(line);
    if (heading) {
      current = heading.key;
      continue;
    }

    const sentences = splitAtomic(line).map(toTestTitle).filter((s) => s.length >= 6);
    if (sentences.length === 0) continue;

    grouped[current].push(...sentences);
  }

  // Keep deterministic order while removing duplicates per section.
  for (const key of Object.keys(grouped) as SectionKey[]) {
    const seen = new Set<string>();
    grouped[key] = grouped[key].filter((s) => {
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
  }

  return grouped;
}

function renderStubFile(gameName: string, section: SectionDef, tests: string[]): string {
  const lines: string[] = [];
  lines.push("import { describe, it } from 'vitest';");
  lines.push("");
  lines.push("/*");
  lines.push("Coverage index:");
  lines.push(`- ${section.title} -> describe('${section.title}')`);
  lines.push("*/");
  lines.push("");
  lines.push(`describe('${gameName} rulebook stubs / ${section.title}', () => {`);
  lines.push(`  describe('${section.title}', () => {`);

  for (const testName of tests) {
    lines.push(`    it.todo('${escapeSingleQuotes(testName)}');`);
    lines.push("");
  }

  lines.push("  });");
  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

function escapeSingleQuotes(text: string): string {
  return text.replace(/'/g, "\\'");
}

async function generateRulebookTestStubs(args: Record<string, unknown>): Promise<ToolResponse> {
  const { resolved, gameName } = resolveProjectPath(args);
  if (!resolved || !gameName) {
    const games = WORKSPACE_PATH ? discoverGames(WORKSPACE_PATH) : [];
    return noProjectPathError(games.length > 1);
  }

  const outputDirArg = (args.outputDir as string | undefined) ?? "test/integration";
  const filenamePattern =
    (args.filenamePattern as string | undefined) ?? "<game>.<section>.test.ts";
  const overwrite = (args.overwrite as boolean | undefined) ?? false;
  const dryRun = (args.dryRun as boolean | undefined) ?? false;
  const maxPages = args.maxPages as number | undefined;

  const outputDir = path.isAbsolute(outputDirArg)
    ? outputDirArg
    : path.join(resolved, outputDirArg);

  const rulebook = await readRulebookText(
    resolved,
    args.filePath as string | undefined,
    maxPages
  );

  if ("error" in rulebook) {
    return { content: [{ type: "text", text: rulebook.error }], isError: true };
  }

  const grouped = buildSectionSentences(rulebook.text);
  const planned: Array<{
    section: SectionKey;
    sectionTitle: string;
    path: string;
    tests: number;
    status: "created" | "updated" | "skipped" | "planned";
  }> = [];

  if (!dryRun) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const section of SECTION_DEFS) {
    const tests = grouped[section.key];
    if (!tests || tests.length === 0) continue;

    const fileName = filenamePattern
      .replaceAll("<game>", gameName)
      .replaceAll("<section>", section.key);
    const targetPath = path.join(outputDir, fileName);
    const exists = fs.existsSync(targetPath);

    if (exists && !overwrite) {
      planned.push({
        section: section.key,
        sectionTitle: section.title,
        path: targetPath,
        tests: tests.length,
        status: dryRun ? "planned" : "skipped",
      });
      continue;
    }

    if (!dryRun) {
      const content = renderStubFile(gameName, section, tests);
      fs.writeFileSync(targetPath, content, "utf-8");
    }

    planned.push({
      section: section.key,
      sectionTitle: section.title,
      path: targetPath,
      tests: tests.length,
      status: dryRun ? "planned" : exists ? "updated" : "created",
    });
  }

  if (planned.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "No recognizable rulebook sections were found (gameplay/pilgrim/artist/merchant/end-game), so no files were generated.",
        },
      ],
      isError: true,
    };
  }

  const summaryLines = planned.map(
    (p) =>
      `- [${p.status}] ${path.relative(resolved, p.path).replaceAll("\\", "/")} (${p.tests} tests) [${p.sectionTitle}]`
  );

  const ambiguous = findAmbiguousLines(rulebook.text);

  const text = [
    `Rulebook used: ${rulebook.fileName}`,
    `Project: ${resolved}`,
    `Output dir: ${outputDir}`,
    dryRun ? "Mode: dry-run (no files written)" : `Overwrite existing: ${overwrite ? "true" : "false"}`,
    "",
    "Files:",
    ...summaryLines,
    "",
    "Ambiguous rule text (review recommended):",
    ...(ambiguous.length > 0 ? ambiguous.map((a) => `- ${a}`) : ["- none detected"]),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
  };
}

function findAmbiguousLines(rulebookText: string): string[] {
  const lines = rulebookText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length > 0);

  const flagged = lines.filter(
    (l) => /\bmay\b|\bcan\b|\bif\b.*\bif\b|\bchoose\b.*\bor\b|\bnone are available\b/i.test(l)
  );

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of flagged) {
    if (seen.has(line)) continue;
    seen.add(line);
    unique.push(line);
    if (unique.length >= 12) break;
  }

  return unique;
}
