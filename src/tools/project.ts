import fs from "fs";
import path from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const WORKSPACE_PATH = process.env.BGA_WORKSPACE_PATH;

// ---- Game discovery -------------------------------------------------------

/** Returns names of subdirectories that look like BGA game projects. */
function discoverGames(workspacePath: string): string[] {
  try {
    return fs
      .readdirSync(workspacePath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => {
        try {
          const files = fs.readdirSync(path.join(workspacePath, name));
          return (
            files.some((f) => f.endsWith(".game.php")) ||
            files.includes("states.inc.php")
          );
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/**
 * Resolve the concrete project path from args:
 *  1. explicit `projectPath`
 *  2. `gameName` resolved under WORKSPACE_PATH
 *  3. auto-select when WORKSPACE_PATH contains exactly one game
 *  4. null
 */
function resolveProjectPath(
  args: Record<string, unknown>
): { resolved: string; gameName: string } | { resolved: null; gameName: null } {
  if (args.projectPath) {
    const p = args.projectPath as string;
    return { resolved: p, gameName: path.basename(p) };
  }
  if (!WORKSPACE_PATH) return { resolved: null, gameName: null };
  if (args.gameName) {
    const p = path.join(WORKSPACE_PATH, args.gameName as string);
    return { resolved: p, gameName: args.gameName as string };
  }
  const games = discoverGames(WORKSPACE_PATH);
  if (games.length === 1) {
    return { resolved: path.join(WORKSPACE_PATH, games[0]), gameName: games[0] };
  }
  return { resolved: null, gameName: null };
}

function noProjectPathError(multipleGames: boolean) {
  const text = multipleGames
    ? "Multiple BGA games found in the workspace. Pass a `gameName` argument (use `bga_list_games` to see available games)."
    : "No projectPath or gameName provided and no VS Code workspace detected. Please supply one.";
  return { content: [{ type: "text", text }], isError: true };
}

// ---- Schema helpers -------------------------------------------------------

const projectPathProp = {
  type: "string",
  description: "Absolute path to the BGA game project root. Overrides gameName when provided.",
};

const gameNameProp = {
  type: "string",
  description: WORKSPACE_PATH
    ? `Name of the game subfolder inside the workspace (e.g. "mygame"). Auto-selected when only one game is present. Use bga_list_games to discover options.`
    : "Name of the game subfolder within the games workspace directory.",
};

// ---- Tool definitions -----------------------------------------------------

export const projectTools: Tool[] = [
  {
    name: "bga_list_games",
    description:
      "List all BGA game projects detected in the workspace (subdirectories containing a *.game.php or states.inc.php).",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: {
          type: "string",
          description: WORKSPACE_PATH
            ? `Parent folder containing game subdirectories. Defaults to: ${WORKSPACE_PATH}`
            : "Parent folder containing game subdirectories.",
        },
      },
      required: [],
    },
  },
  {
    name: "bga_list_project_files",
    description: "List all files in a BGA game project directory.",
    inputSchema: {
      type: "object",
      properties: {
        gameName: gameNameProp,
        projectPath: projectPathProp,
        recursive: {
          type: "boolean",
          description: "Whether to list files recursively (default: false)",
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: "bga_read_project_file",
    description: "Read the contents of a file in a BGA game project.",
    inputSchema: {
      type: "object",
      properties: {
        gameName: gameNameProp,
        projectPath: projectPathProp,
        filePath: {
          type: "string",
          description: "Relative path to the file within the project (e.g. 'states.inc.php')",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "bga_analyze_game_states",
    description: "Parse and summarize the game states defined in a local states.inc.php file.",
    inputSchema: {
      type: "object",
      properties: {
        gameName: gameNameProp,
        projectPath: projectPathProp,
      },
      required: [],
    },
  },
  {
    name: "bga_list_player_actions",
    description: "List all player action methods defined in the main game PHP file.",
    inputSchema: {
      type: "object",
      properties: {
        gameName: gameNameProp,
        projectPath: projectPathProp,
      },
      required: [],
    },
  },
];

// ---- Handler --------------------------------------------------------------

export async function handleProjectTool(
  name: string,
  args: Record<string, unknown>
) {
  if (name === "bga_list_games") {
    const ws = (args.workspacePath as string | undefined) ?? WORKSPACE_PATH;
    if (!ws) {
      return {
        content: [{ type: "text", text: "No workspacePath provided and BGA_WORKSPACE_PATH is not set." }],
        isError: true,
      };
    }
    return listGames(ws);
  }

  const { resolved, gameName } = resolveProjectPath(args);
  if (!resolved) {
    const games = WORKSPACE_PATH ? discoverGames(WORKSPACE_PATH) : [];
    return noProjectPathError(games.length > 1);
  }

  if (name === "bga_list_project_files") {
    return listProjectFiles(resolved, (args.recursive as boolean) ?? false);
  }
  if (name === "bga_read_project_file") {
    return readProjectFile(resolved, args.filePath as string);
  }
  if (name === "bga_analyze_game_states") {
    return analyzeGameStates(resolved, gameName ?? path.basename(resolved));
  }
  if (name === "bga_list_player_actions") {
    return listPlayerActions(resolved);
  }
  return { content: [{ type: "text", text: `Unknown project tool: ${name}` }], isError: true };
}

// ---- Implementations ------------------------------------------------------

function listGames(workspacePath: string) {
  const games = discoverGames(workspacePath);
  if (games.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No BGA game projects found in \`${workspacePath}\`.\n\nA directory is recognised as a BGA project when it contains a \`*.game.php\` or \`states.inc.php\` file.`,
        },
      ],
    };
  }
  const lines = games.map((g) => {
    const files = fs.readdirSync(path.join(workspacePath, g));
    const hasStates = files.includes("states.inc.php");
    const gamePhp = files.find((f) => f.endsWith(".game.php"));
    const tags = [gamePhp && "game.php", hasStates && "states.inc.php"].filter(Boolean).join(", ");
    return `- **${g}** (${tags})`;
  });
  return {
    content: [
      {
        type: "text",
        text: `## BGA Games in \`${workspacePath}\` (${games.length} found)\n\n${lines.join("\n")}`,
      },
    ],
  };
}

function listProjectFiles(projectPath: string, recursive: boolean) {
  try {
    const files = walkDir(projectPath, recursive);
    const text = files.join("\n");
    return {
      content: [
        {
          type: "text",
          text: `## Files in ${projectPath}\n\n${text}`,
        },
      ],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error listing files: ${msg}` }],
      isError: true,
    };
  }
}

function walkDir(dir: string, recursive: boolean, base = ""): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(`📁 ${relPath}/`);
      if (recursive) {
        results.push(...walkDir(path.join(dir, entry.name), recursive, relPath));
      }
    } else {
      results.push(`📄 ${relPath}`);
    }
  }
  return results;
}

function readProjectFile(projectPath: string, filePath: string) {
  try {
    const fullPath = path.join(projectPath, filePath);
    const content = fs.readFileSync(fullPath, "utf-8");
    const ext = path.extname(filePath).replace(".", "");
    const lang = ext === "php" ? "php" : ext === "js" ? "javascript" : ext;
    return {
      content: [
        {
          type: "text",
          text: `## ${filePath}\n\n\`\`\`${lang}\n${content}\n\`\`\``,
        },
      ],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error reading file "${filePath}": ${msg}` }],
      isError: true,
    };
  }
}

function analyzeGameStates(projectPath: string, gameName: string) {
  try {
    const statesPath = path.join(projectPath, "states.inc.php");
    const content = fs.readFileSync(statesPath, "utf-8");

    const stateRegex = /(\d+)\s*=>\s*\[[\s\S]*?"name"\s*=>\s*"([^"]+)"/g;

    const stateMatches = [...content.matchAll(stateRegex)];
    if (stateMatches.length === 0) {
      return {
        content: [
          { type: "text", text: "No game states found in states.inc.php. Is this a valid BGA project?" },
        ],
      };
    }

    // Split content into per-state blocks for detailed parsing
    const stateBlocks = content.split(/(?=\n\s*\d+\s*=>)/);
    const stateDetails: string[] = [];

    for (const match of stateMatches) {
      const id = match[1];
      const name = match[2];
      const block = stateBlocks.find((b) => {
        const blockIdMatch = b.match(/^\s*(\d+)\s*=>/);
        return blockIdMatch && blockIdMatch[1] === id;
      }) ?? "";
      const typeMatch = block.match(/"type"\s*=>\s*"([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : "unknown";
      const transMatch = block.match(/"transitions"\s*=>\s*\[([\s\S]*?)\]/);
      const transitions = transMatch
        ? transMatch[1]
            .match(/"([^"]+)"\s*=>\s*(\d+)/g)
            ?.map((t) => t.replace(/"/g, ""))
            .map((t) => `  - ${t}`)
            .join("\n") ?? "  (none)"
        : "  (none)";
      stateDetails.push(`**State ${id}: ${name}** (${type})\n${transitions}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `## Game States – ${gameName}\n\n${stateDetails.join("\n\n")}`,
        },
      ],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error analyzing states: ${msg}` }],
      isError: true,
    };
  }
}

function listPlayerActions(projectPath: string) {
  try {
    // Find the main game PHP file (*.game.php)
    const files = fs.readdirSync(projectPath);
    const gamePhp = files.find((f) => f.endsWith(".game.php"));
    if (!gamePhp) {
      return {
        content: [
          { type: "text", text: "No *.game.php file found in the project directory." },
        ],
        isError: true,
      };
    }

    const content = fs.readFileSync(path.join(projectPath, gamePhp), "utf-8");

    // BGA actions are called via ajaxcall in JS; on PHP side they're plain public/protected functions
    // after a checkAction() call. We detect functions that call self::checkAction or $this->checkAction.
    const checkActionRegex = /function\s+(\w+)\s*\(([^)]*)\)[\s\S]*?(?:self::|(?:\$this->))checkAction/g;
    const matches = [...content.matchAll(checkActionRegex)];

    if (matches.length === 0) {
      return {
        content: [
          { type: "text", text: `No player actions (functions with checkAction) found in ${gamePhp}.` },
        ],
      };
    }

    const actions = matches.map(
      (m) => `- \`${m[1]}(${m[2].trim()})\``
    );

    return {
      content: [
        {
          type: "text",
          text: `## Player actions in ${gamePhp}\n\n${actions.join("\n")}`,
        },
      ],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error listing player actions: ${msg}` }],
      isError: true,
    };
  }
}
