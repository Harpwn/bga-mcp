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
  {
    name: "bga_generate_vitest_config",
    description:
      "Generate a vitest.config.ts file for a BGA game project with sensible defaults: " +
      "serial file execution, forks pool, and a configurable per-test timeout (default 2500ms). " +
      "Also creates .vscode/settings.json pointing the Vitest VS Code extension at the config.",
    inputSchema: {
      type: "object",
      properties: {
        gameName: gameNameProp,
        projectPath: projectPathProp,
        testTimeout: {
          type: "number",
          description: "Per-test timeout in milliseconds (default: 2500).",
        },
        overwrite: {
          type: "boolean",
          description: "Overwrite existing vitest.config.ts when true (default: false).",
        },
      },
      required: [],
    },
  },
  {
    name: "bga_scaffold_seed_catalog",
    description:
      "Scaffold a complete testing setup for a BGA game: vitest.config.ts, .vscode/settings.json, " +
      "test/integration/helpers/<game>.helpers.ts when missing, and the standard seed-catalog harness " +
      "(seed-catalog.ts, scan-seeds.ts, verify-catalog.ts, seed-catalog.json) backed by shared bga-lite helpers. " +
      "Optionally adds npm scripts.",
    inputSchema: {
      type: "object",
      properties: {
        gameName: gameNameProp,
        projectPath: projectPathProp,
        helperFile: {
          type: "string",
          description:
            "Path to the game helper module relative to project root (default: test/integration/helpers/<game>.helpers.ts).",
        },
        createSessionHelper: {
          type: "string",
          description: "Export name from helperFile used to create scenario sessions (default: createScenarioSession).",
        },
        stepHelper: {
          type: "string",
          description:
            "Export name from helperFile used to advance one deterministic step (default: chooseDieByPriority).",
        },
        scenarioKeys: {
          type: "array",
          items: { type: "string" },
          description:
            "Scenario keys to include in the generated ScenarioKey union and scanner placeholders.",
        },
        actionName: {
          type: "string",
          description: "Action required for stepping. Used in generated guard checks (default: actChooseDie).",
        },
        bgaLitePath: {
          type: "string",
          description: "Absolute path to bga-lite root directory. Auto-detected as sibling 'bga-lite' if omitted.",
        },
        includeVitestConfig: {
          type: "boolean",
          description: "Generate vitest.config.ts and .vscode/settings.json as part of the setup (default: true).",
        },
        createHelperFile: {
          type: "boolean",
          description: "Create a minimal helper file when the expected helper module is missing (default: true).",
        },
        addPackageScripts: {
          type: "boolean",
          description: "Add scan-seeds and verify-catalog npm scripts to package.json when true (default: true).",
        },
        overwrite: {
          type: "boolean",
          description: "Overwrite existing harness files when true (default: false).",
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
  if (name === "bga_scaffold_seed_catalog") {
    return scaffoldSeedCatalog(args);
  }
  if (name === "bga_generate_vitest_config") {
    return generateVitestConfig(args);
  }
  if (name !== "bga_generate_rulebook_test_stubs") {
    return {
      content: [{ type: "text", text: `Unknown test-stub tool: ${name}` }],
      isError: true,
    };
  }

  return generateRulebookTestStubs(args);
}

function asImportPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function renderScenarioUnion(keys: string[]): string {
  if (keys.length === 0) {
    return "  | 'replace.me';";
  }
  return keys.map((k) => `  | '${k.replaceAll("'", "\\'")}';`).join("\n");
}

function renderScenarioArray(keys: string[]): string {
  if (keys.length === 0) {
    return "  'replace.me',";
  }
  return keys.map((k) => `  '${k.replaceAll("'", "\\'")}',`).join("\n");
}

function renderMatchCases(keys: string[]): string {
  if (keys.length === 0) {
    return [
      "    case 'replace.me':",
      "      // TODO: return context object when this scenario is matched.",
      "      return null;",
    ].join("\n");
  }

  return keys.map((key) => {
    const safe = key.replaceAll("'", "\\'");
    return [
      `    case '${safe}':`,
      "      // TODO: implement scenario matcher.",
      "      // Example:",
      "      // if (effect.character === 'artist' && effect.artistAction === 'paint') return { position: effect.position };",
      "      return null;",
    ].join("\n");
  }).join("\n\n");
}

function updatePackageScripts(projectPath: string): { updated: boolean; note: string } {
  const packageJsonPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return { updated: false, note: "package.json not found; scripts were not added" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return { updated: false, note: "package.json is not valid JSON; scripts were not added" };
  }

  const scripts = ((parsed.scripts as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  let changed = false;

  if (!scripts["scan-seeds"]) {
    scripts["scan-seeds"] = "tsx test/integration/helpers/scan-seeds.ts";
    changed = true;
  }
  if (!scripts["verify-catalog"]) {
    scripts["verify-catalog"] = "tsx test/integration/helpers/verify-catalog.ts";
    changed = true;
  }

  if (!changed) {
    return { updated: false, note: "scan-seeds and verify-catalog scripts already exist" };
  }

  parsed.scripts = scripts;
  fs.writeFileSync(packageJsonPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
  return { updated: true, note: "Added scan-seeds and verify-catalog scripts to package.json" };
}

async function scaffoldSeedCatalog(args: Record<string, unknown>): Promise<ToolResponse> {
  const { resolved, gameName } = resolveProjectPath(args);
  if (!resolved || !gameName) {
    const games = WORKSPACE_PATH ? discoverGames(WORKSPACE_PATH) : [];
    return noProjectPathError(games.length > 1);
  }

  const overwrite = args.overwrite === true;
  const includeVitestConfig = args.includeVitestConfig !== false;
  const createHelperFile = args.createHelperFile !== false;
  const addPackageScripts = args.addPackageScripts !== false;
  const actionName = (args.actionName as string | undefined) ?? "actChooseDie";
  const createSessionHelper = (args.createSessionHelper as string | undefined) ?? "createScenarioSession";
  const stepHelper = (args.stepHelper as string | undefined) ?? "chooseDieByPriority";
  const scenarioKeys = Array.isArray(args.scenarioKeys)
    ? (args.scenarioKeys.map((k) => String(k)).filter((k) => k.length > 0))
    : [];

  const helperFile = (args.helperFile as string | undefined) ?? `test/integration/helpers/${gameName}.helpers.ts`;
  const helperAbsPath = path.isAbsolute(helperFile) ? helperFile : path.join(resolved, helperFile);
  const helperDir = path.dirname(helperAbsPath);
  const helperImportPath = asImportPath(`./${path.basename(helperFile).replace(/\.ts$/i, ".js")}`);

  const bgaLiteRoot =
    (args.bgaLitePath as string | undefined) ??
    path.join(path.dirname(resolved), "bga-lite");
  const bgaLiteSeedCatalog = path.join(bgaLiteRoot, "src", "testing", "seed-catalog.js");
  const bgaLiteSeedCatalogCli = path.join(bgaLiteRoot, "src", "testing", "seed-catalog-cli.js");
  const bgaLiteRuntimeIndex = path.join(bgaLiteRoot, "src", "runtime", "index.js");
  const bgaLiteRuntimeSession = path.join(bgaLiteRoot, "src", "runtime", "session.js");

  if (!fs.existsSync(bgaLiteSeedCatalog) || !fs.existsSync(bgaLiteSeedCatalogCli)) {
    return {
      content: [{
        type: "text",
        text:
          `Could not find bga-lite seed catalog helpers at: ${bgaLiteSeedCatalog} and ${bgaLiteSeedCatalogCli}. ` +
          "Pass bgaLitePath or ensure bga-lite/src/testing/seed-catalog.ts and seed-catalog-cli.ts exist.",
      }],
      isError: true,
    };
  }

  const seedCatalogImportPath = asImportPath(path.relative(helperDir, bgaLiteSeedCatalog));
  const runtimeIndexImportPath = asImportPath(path.relative(helperDir, bgaLiteRuntimeIndex));
  const runtimeSessionImportPath = asImportPath(path.relative(helperDir, bgaLiteRuntimeSession));
  const scenarioUnion = renderScenarioUnion(scenarioKeys);
  const scenarioArray = renderScenarioArray(scenarioKeys);
  const matchCases = renderMatchCases(scenarioKeys);
  const files = [] as Array<{ relativePath: string; content: string }>;

  if (includeVitestConfig) {
    files.push({
      relativePath: "vitest.config.ts",
      content: [
        "import { defineConfig } from 'vitest/config';",
        "",
        "export default defineConfig({",
        "  test: {",
        "    // Each scenario session gets its own isolated DB state. Forked workers are safe.",
        "    pool: 'forks',",
        "    testTimeout: 2500,",
        "    hookTimeout: 2500,",
        "    retry: 0,",
        "  },",
        "});",
        "",
      ].join("\n"),
    });

    files.push({
      relativePath: path.join(".vscode", "settings.json"),
      content: JSON.stringify({ "vitest.rootConfig": "./vitest.config.ts" }, null, 2) + "\n",
    });
  }

  if (createHelperFile) {
    files.push({
      relativePath: path.relative(resolved, helperAbsPath).replaceAll("\\", "/"),
      content: [
        "import path from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        `import { createRuntime } from '${runtimeIndexImportPath}';`,
        `import type { RuntimeSession } from '${runtimeSessionImportPath}';`,
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');",
        `const GAME_DIR = path.join(WORKSPACE_ROOT, '${gameName}');`,
        "",
        "export async function createScenarioSession(seed: number): Promise<RuntimeSession> {",
        "  const runtime = createRuntime();",
        "  return runtime.createSession({",
        "    mode: 'scenario',",
        "    game: GAME_DIR,",
        "    seed,",
        "    players: [",
        "      { id: 1000001, name: 'P1', color: 'ff0000', number: 1 },",
        "      { id: 1000002, name: 'P2', color: '008000', number: 2 },",
        "    ],",
        "  });",
        "}",
        "",
        "export async function chooseDieByPriority(session: RuntimeSession, state: { possibleActions: string[] }, slotPriority: number[] = [1, 2, 3]) {",
        `  const actionName = '${actionName}';`,
        "  if (!state.possibleActions.includes(actionName)) {",
        "    throw new Error(`No ${actionName} action available in current state`);",
        "  }",
        "",
        "  const action = await session.getState();",
        "  const activePlayerId = action.activePlayers[0];",
        "  const step = await session.performAction({",
        "    playerId: activePlayerId,",
        "    name: actionName,",
        "    args: {},",
        "  });",
        "",
        "  return { step, dieChosen: step.notifications.find((notification) => notification.type === 'dieChosen') };",
        "}",
        "",
      ].join("\n"),
    });
  } else if (!fs.existsSync(helperAbsPath)) {
    return {
      content: [{ type: "text", text: `Helper file not found: ${helperFile}. Pass createHelperFile:true to scaffold it.` }],
      isError: true,
    };
  }

  files.push(
    {
      relativePath: path.join("test", "integration", "helpers", "seed-catalog.ts"),
      content: [
        "import path from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        "import {",
        "  loadSeedCatalogFile,",
        "  requireSeedCatalogEntry,",
        "  type SeedCatalog,",
        "  type SeedCatalogEntry,",
        `} from '${seedCatalogImportPath}';`,
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "const CATALOG_PATH = path.join(__dirname, 'seed-catalog.json');",
        "",
        "export type ScenarioKey =",
        scenarioUnion,
        "",
        "export type CatalogEntry = SeedCatalogEntry;",
        "",
        "type Catalog = SeedCatalog<ScenarioKey>;",
        "",
        "const catalog: Catalog = loadSeedCatalogFile<ScenarioKey>(CATALOG_PATH);",
        "",
        "export function getCatalogEntry(key: ScenarioKey): CatalogEntry | undefined {",
        "  return catalog[key];",
        "}",
        "",
        "export function requireCatalogEntry(key: ScenarioKey): CatalogEntry {",
        "  return requireSeedCatalogEntry(catalog, key, 'npm run scan-seeds');",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: path.join("test", "integration", "helpers", "scan-seeds.ts"),
      content: [
        "import path from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        `import { ${createSessionHelper}, ${stepHelper} } from '${helperImportPath}';`,
        "import {",
        "  defaultEffectFingerprint,",
        "  saveSeedCatalogFile,",
        "  scanSeedCatalog,",
        "  type SeedCatalog,",
        "  type SeedScanState,",
        `} from '${seedCatalogImportPath}';`,
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "const CATALOG_PATH = path.join(__dirname, 'seed-catalog.json');",
        "",
        "export type ScenarioKey =",
        scenarioUnion,
        "",
        "type Catalog = SeedCatalog<ScenarioKey>;",
        "type ScenarioState = SeedScanState;",
        "",
        "function matchStep(",
        "  key: ScenarioKey,",
        "  effect: Record<string, unknown>,",
        "  stateName: string,",
        "): Record<string, unknown> | null {",
        "  switch (key) {",
        matchCases,
        "",
        "    default:",
        "      return null;",
        "  }",
        "}",
        "",
        "const allKeys: ScenarioKey[] = [",
        scenarioArray,
        "];",
        "",
        "async function scan(seedStart: number, seedEnd: number, maxSteps: number): Promise<{ catalog: Catalog; missing: ScenarioKey[] }> {",
        `  return scanSeedCatalog<ScenarioKey, Awaited<ReturnType<typeof ${createSessionHelper}>>, ScenarioState>({`,
        "    keys: allKeys,",
        "    seedStart,",
        "    seedEnd,",
        "    maxSteps,",
        `    createSession: ${createSessionHelper},`,
        "    getInitialState: (session) => session.getState(),",
        "    performStep: async (session, state) => {",
        `      if (!state.possibleActions.includes('${actionName}')) {`,
        "        return null;",
        "      }",
        "",
        "      // TODO: adapt this to your helper return shape if needed.",
        `      const pick = await ${stepHelper}(session, state as never);`,
        "      const stateAfter = (pick.step?.stateAfter ?? pick.stateAfter ?? null) as ScenarioState | null;",
        "      if (!stateAfter) {",
        "        return null;",
        "      }",
        "",
        "      const effect = (pick.dieChosen?.args?.effect ?? pick.effect ?? {}) as Record<string, unknown>;",
        "      return { stateAfter, effect };",
        "    },",
        "    matchScenario: ({ key, effect, stateName }) => matchStep(key, effect, stateName),",
        "    makeFingerprint: defaultEffectFingerprint,",
        "    onProgress: (seed, end, remaining) => {",
        "      process.stdout.write(`\\rSeed ${seed}/${end}  (${remaining} scenarios remaining)   `);",
        "    },",
        "  });",
        "}",
        "",
        "const args = process.argv.slice(2);",
        "let seedStart = 1;",
        "let seedEnd = 500;",
        "let maxSteps = 30;",
        "",
        "for (let i = 0; i < args.length; i += 1) {",
        "  if (args[i] === '--seeds' && args[i + 1]) {",
        "    const [s, e] = args[i + 1].split(':').map(Number);",
        "    seedStart = s;",
        "    seedEnd = e ?? s + 500;",
        "    i += 1;",
        "  } else if (args[i] === '--steps' && args[i + 1]) {",
        "    maxSteps = Number(args[i + 1]);",
        "    i += 1;",
        "  }",
        "}",
        "",
        "async function main() {",
        "  console.log(`Scanning seeds ${seedStart}–${seedEnd}, up to ${maxSteps} steps each...`);",
        "  const { catalog, missing } = await scan(seedStart, seedEnd, maxSteps);",
        "",
        "  process.stdout.write('\\n');",
        "  if (missing.length > 0) {",
        "    console.warn(`Warning: ${missing.length} scenario(s) not found in seed range ${seedStart}-${seedEnd}:`);",
        "    for (const key of missing) {",
        "      console.warn(`  - ${key}`);",
        "    }",
        "  }",
        "",
        "  const merged = saveSeedCatalogFile<ScenarioKey>(CATALOG_PATH, catalog, { merge: true });",
        "  console.log(`Catalog written to ${CATALOG_PATH}`);",
        "  console.log(`Entries: ${Object.keys(merged).length} / ${allKeys.length}`);",
        "}",
        "",
        "main().catch((err) => {",
        "  console.error(err);",
        "  process.exit(1);",
        "});",
        "",
      ].join("\n"),
    },
    {
      relativePath: path.join("test", "integration", "helpers", "verify-catalog.ts"),
      content: [
        "import path from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        `import { ${createSessionHelper}, ${stepHelper} } from '${helperImportPath}';`,
        "import type { ScenarioKey } from './seed-catalog.js';",
        "import {",
        "  createSeedCatalogVerifyCli,",
        "  defaultEffectFingerprint,",
        "  formatSeedCatalogVerificationLine,",
        "  formatSeedCatalogVerificationSummary,",
        "  type SeedScanState,",
        `} from '${seedCatalogImportPath}';`,
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "const CATALOG_PATH = path.join(__dirname, 'seed-catalog.json');",
        "",
        "type ScenarioState = SeedScanState;",
        "",
        "export async function createCatalogVerifier(meta: { url: string }) {",
        "  return createSeedCatalogVerifyCli<ScenarioKey, Awaited<ReturnType<typeof ${createSessionHelper}>>, ScenarioState>(",
        "    {",
        "      catalogPath: CATALOG_PATH,",
        `      createSession: ${createSessionHelper},`,
        "      getInitialState: (session) => session.getState(),",
        "      performStep: async (session, state) => {",
        `        if (!state.possibleActions.includes('${actionName}')) {`,
        "          return null;",
        "        }",
        `        const pick = await ${stepHelper}(session, state as never);`,
        "        const stateAfter = (pick.step?.stateAfter ?? pick.stateAfter ?? null) as ScenarioState | null;",
        "        if (!stateAfter) {",
        "          return null;",
        "        }",
        "",
        "        const effect = (pick.dieChosen?.args?.effect ?? pick.effect ?? {}) as Record<string, unknown>;",
        "        return { stateAfter, effect };",
        "      },",
        "      makeFingerprint: defaultEffectFingerprint,",
        "      onEmptyCatalog: () => {",
        "        console.log('Catalog is empty.');",
        "      },",
        "      onMissingFingerprint: (_entry, key) => {",
        "        process.stdout.write(formatSeedCatalogVerificationLine({ key, seed: _entry.seed, step: _entry.step }));",
        "        console.log('SKIP (no fingerprint — re-run scan-seeds)');",
        "      },",
        "      onEntryResult: (entry, key, result) => {",
        "        process.stdout.write(formatSeedCatalogVerificationLine({ key, seed: entry.seed, step: entry.step }));",
        "",
        "        if (result.status === 'ok') {",
        "          console.log('✓');",
        "        } else if (result.status === 'mismatch') {",
        "          console.log('✗  FINGERPRINT MISMATCH — catalog is stale');",
        "        } else {",
        "          console.log('✗  ERROR (could not replay to step)');",
        "        }",
        "      },",
        "      onSummary: ({ passed, failed }) => {",
        "        for (const line of formatSeedCatalogVerificationSummary(passed, failed)) {",
        "          console.log(`\\n${line}`);",
        "        }",
        "      },",
        "    },",
        "    meta,",
        "  );",
        "}",
        "",
        "async function main() {",
        "  const { verifyCatalog } = await createCatalogVerifier({ url: import.meta.url });",
        "  await verifyCatalog();",
        "}",
        "",
        "main().catch((err) => {",
        "  console.error(err);",
        "  process.exit(1);",
        "});",
        "",
      ].join("\n"),
    },
    {
      relativePath: path.join("test", "integration", "helpers", "seed-catalog.json"),
      content: "{}\n",
    },
    {
      relativePath: path.join("test", "integration", "helpers", "vitest.global-setup.ts"),
      content: [
        "import { createCatalogVerifier } from './verify-catalog.js';",
        "",
        "export default async function globalSetup() {",
        "  const { verifyCatalog } = await createCatalogVerifier({ url: import.meta.url });",
        "  await verifyCatalog();",
        "}",
        "",
      ].join("\n"),
    }
  );

  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const targetPath = path.join(resolved, file.relativePath);
    const exists = fs.existsSync(targetPath);

    if (exists && !overwrite) {
      skipped.push(`${file.relativePath} (already exists)`);
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.content, "utf-8");
    written.push(file.relativePath);
  }

  let scriptsNote = "package.json scripts unchanged";
  if (addPackageScripts) {
    scriptsNote = updatePackageScripts(resolved).note;
  }

  const text = [
    `Project: ${resolved}`,
    `Helper file: ${helperFile}`,
    `bga-lite helper: ${bgaLiteSeedCatalog}`,
    `Overwrite existing: ${overwrite ? "true" : "false"}`,
    "",
    `Written: ${written.length ? written.join(", ") : "none"}`,
    `Skipped: ${skipped.length ? skipped.join(", ") : "none"}`,
    `Scripts: ${scriptsNote}`,
    "",
    "Next steps:",
    "1) Fill in matchStep() in scan-seeds.ts with game-specific scenario logic.",
    "2) Adjust step helper return mapping if your helper does not expose step/dieChosen/effect.",
    "3) Run npm run scan-seeds then npm run verify-catalog.",
  ].join("\n");

  return { content: [{ type: "text", text }] };
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

async function generateVitestConfig(args: Record<string, unknown>): Promise<ToolResponse> {
  const { resolved } = resolveProjectPath(args);
  if (!resolved) {
    const games = WORKSPACE_PATH ? discoverGames(WORKSPACE_PATH) : [];
    return noProjectPathError(games.length > 1);
  }

  const timeout = typeof args.testTimeout === "number" ? args.testTimeout : 2_500;
  const overwrite = args.overwrite === true;

  const vitestConfigPath = path.join(resolved, "vitest.config.ts");
  const vscodeSettingsPath = path.join(resolved, ".vscode", "settings.json");

  const vitestConfigContent =
    `import { defineConfig } from 'vitest/config';\n` +
    `\n` +
    `export default defineConfig({\n` +
    `  test: {\n` +
    `    // Each scenario session uses a unique SQLite DB in tmpdir — safe to parallelise.\n` +
    `    pool: 'forks',\n` +
    `    testTimeout: ${timeout},\n` +
    `    hookTimeout: ${timeout},\n` +
    `    retry: 0,\n` +
    `  },\n` +
    `});\n`;

  const vscodeSettingsContent = JSON.stringify({ "vitest.rootConfig": "./vitest.config.ts" }, null, 2) + "\n";

  const written: string[] = [];
  const skipped: string[] = [];

  // Write vitest.config.ts
  if (fs.existsSync(vitestConfigPath) && !overwrite) {
    skipped.push("vitest.config.ts (already exists; pass overwrite:true to replace)");
  } else {
    fs.writeFileSync(vitestConfigPath, vitestConfigContent, "utf-8");
    written.push("vitest.config.ts");
  }

  // Write .vscode/settings.json
  const vscodeDir = path.join(resolved, ".vscode");
  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true });
  }
  if (fs.existsSync(vscodeSettingsPath) && !overwrite) {
    skipped.push(".vscode/settings.json (already exists; pass overwrite:true to replace)");
  } else {
    fs.writeFileSync(vscodeSettingsPath, vscodeSettingsContent, "utf-8");
    written.push(".vscode/settings.json");
  }

  const lines: string[] = [];
  if (written.length) lines.push(`Written: ${written.join(", ")}`);
  if (skipped.length) lines.push(`Skipped: ${skipped.join(", ")}`);
  lines.push(`testTimeout / hookTimeout: ${timeout}ms`);
  lines.push(
    `Install the 'vitest.explorer' VS Code extension to see tests in the Test Explorer panel.`
  );

  return { content: [{ type: "text", text: lines.join("\n") }] };
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
