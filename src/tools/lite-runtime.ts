import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { WORKSPACE_PATH } from "../config.js";

type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type SessionMode = "scenario" | "debug";

interface RuntimeLike {
  createSession(options: Record<string, unknown>): Promise<RuntimeSessionLike>;
  loadSession(options: { id: string }): Promise<RuntimeSessionLike>;
  listSessions(): unknown[];
  closeSession(id: string): Promise<void>;
}

interface RuntimeSessionLike {
  id: string;
  getSummary(): unknown;
  getState(): Promise<Record<string, unknown>>;
  getGameDatas(): Promise<Record<string, unknown>>;
  getPlayers(): Promise<unknown[]>;
  performAction(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  resetSession(options?: { seed?: number }): Promise<Record<string, unknown>>;
  getEventTimeline(): unknown[];
  getWarnings(): unknown[];
}

type RuntimeFactory = () => Promise<RuntimeLike>;

let runtimeSingleton: RuntimeLike | null = null;

function resolveGamePath(game: string): string {
  if (path.isAbsolute(game)) {
    return game;
  }

  const roots = [WORKSPACE_PATH, process.cwd(), path.join(process.cwd(), "..")].filter(
    (v): v is string => typeof v === "string"
  );

  const candidates = roots.map((root) => path.resolve(root, game));
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "gameinfos.inc.php"))) {
      return candidate;
    }
  }

  return path.resolve(game);
}

function resolveBgaLiteRuntimeEntry(): string | null {
  const roots = [WORKSPACE_PATH, process.cwd(), path.join(process.cwd(), "..")].filter(
    (v): v is string => typeof v === "string"
  );

  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(path.resolve(root, "bga-lite", "dist", "src", "runtime", "index.js"));
    candidates.push(path.resolve(root, "..", "bga-lite", "dist", "src", "runtime", "index.js"));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function defaultRuntimeFactory(): Promise<RuntimeLike> {
  if (runtimeSingleton) {
    return runtimeSingleton;
  }

  const runtimeEntry = resolveBgaLiteRuntimeEntry();
  if (!runtimeEntry) {
    throw new Error(
      "Could not find bga-lite runtime build output at dist/src/runtime/index.js. " +
        "Build bga-lite first with `npm run build` in the bga-lite project."
    );
  }

  const moduleUrl = pathToFileURL(runtimeEntry).href;
  const runtimeModule = (await import(moduleUrl)) as {
    createRuntime?: () => RuntimeLike;
  };

  if (typeof runtimeModule.createRuntime !== "function") {
    throw new Error(`bga-lite runtime module at ${runtimeEntry} does not export createRuntime()`);
  }

  runtimeSingleton = runtimeModule.createRuntime();
  return runtimeSingleton;
}

let getRuntimeImpl: RuntimeFactory = defaultRuntimeFactory;

export function setRuntimeFactoryForTests(factory: RuntimeFactory): void {
  getRuntimeImpl = factory;
  runtimeSingleton = null;
}

export function resetRuntimeFactoryForTests(): void {
  getRuntimeImpl = defaultRuntimeFactory;
  runtimeSingleton = null;
}

function parseFormat(args: Record<string, unknown>): "summary" | "machine" {
  return args.format === "machine" ? "machine" : "summary";
}

function machineOrSummary(format: "summary" | "machine", summary: string, payload: unknown): ToolResponse {
  if (format === "machine") {
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
  return {
    content: [{ type: "text", text: summary }],
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stateSummary(state: Record<string, unknown>): string {
  const name = String(state.name ?? "unknown");
  const stateId = Number(state.stateId ?? 0);
  const activePlayers = Array.isArray(state.activePlayers) ? state.activePlayers : [];
  const possibleActions = Array.isArray(state.possibleActions) ? state.possibleActions : [];

  return [
    `State: ${name} (ID: ${stateId})`,
    `Active players: ${activePlayers.join(", ") || "none"}`,
    `Possible actions: ${possibleActions.join(", ") || "none"}`,
  ].join("\n");
}

export const liteRuntimeTools: Tool[] = [
  {
    name: "bga_runtime_create_session",
    description:
      "Create a bga-lite runtime session using the Runtime API. Thin wrapper around runtime.createSession().",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["scenario", "debug"],
          description: "Session mode.",
        },
        game: {
          type: "string",
          description: "Absolute path or workspace-relative game directory.",
        },
        seed: {
          type: "number",
          description: "Optional deterministic seed.",
        },
        players: {
          type: "array",
          description: "Optional explicit player slots.",
          items: {
            type: "object",
          },
        },
        persistPath: {
          type: "string",
          description: "Debug mode only: optional persisted DB path.",
        },
        reset: {
          type: "boolean",
          description: "Debug mode only: force reset on create.",
        },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["mode", "game"],
    },
  },
  {
    name: "bga_runtime_load_session",
    description: "Load an existing runtime session by ID via runtime.loadSession().",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID." },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "bga_runtime_list_sessions",
    description: "List runtime sessions via runtime.listSessions().",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: [],
    },
  },
  {
    name: "bga_session_get_state",
    description: "Get current state via session.getState().",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID." },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "bga_session_get_players",
    description: "Get players via session.getPlayers().",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID." },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "bga_session_get_gamedatas",
    description: "Get game data via session.getGameDatas().",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID." },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "bga_session_perform_action",
    description:
      "Perform a player action via session.performAction(). Returns structured step result and change summary.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID." },
        playerId: { type: "number", description: "Acting player ID." },
        name: { type: "string", description: "Action method name." },
        args: { type: "object", description: "Action args payload." },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["id", "playerId", "name"],
    },
  },
  {
    name: "bga_session_reset",
    description: "Reset session via session.resetSession().",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID." },
        seed: { type: "number", description: "Optional seed override." },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "bga_session_timeline",
    description: "Get event timeline via session.getEventTimeline().",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID." },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "bga_session_warnings",
    description: "Get runtime warnings via session.getWarnings().",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID." },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "bga_session_close",
    description: "Close and remove a session via runtime.closeSession().",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Session ID." },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description: "Response format.",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleLiteRuntimeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const format = parseFormat(args);
  try {
    const runtime = await getRuntimeImpl();

    if (name === "bga_runtime_create_session") {
      const mode = String(args.mode) as SessionMode;
      const game = String(args.game ?? "");
      const options: Record<string, unknown> = {
        mode,
        game: resolveGamePath(game),
      };

      if (typeof args.seed === "number") options.seed = args.seed;
      if (Array.isArray(args.players)) options.players = args.players;
      if (typeof args.persistPath === "string") options.persistPath = args.persistPath;
      if (typeof args.reset === "boolean") options.reset = args.reset;

      const session = await runtime.createSession(options);
      const summaryObj = session.getSummary();
      return machineOrSummary(
        format,
        `Created ${mode} session ${session.id}.`,
        { success: true, session: summaryObj }
      );
    }

    if (name === "bga_runtime_load_session") {
      const id = String(args.id ?? "");
      const session = await runtime.loadSession({ id });
      const summaryObj = session.getSummary();
      return machineOrSummary(
        format,
        `Loaded session ${id}.`,
        { success: true, session: summaryObj }
      );
    }

    if (name === "bga_runtime_list_sessions") {
      const sessions = runtime.listSessions();
      return machineOrSummary(
        format,
        `Listed ${sessions.length} session(s).`,
        { success: true, sessions }
      );
    }

    if (name === "bga_session_close") {
      const id = String(args.id ?? "");
      await runtime.closeSession(id);
      return machineOrSummary(
        format,
        `Closed session ${id}.`,
        { success: true, id }
      );
    }

    const id = String(args.id ?? "");
    const session = await runtime.loadSession({ id });

    if (name === "bga_session_get_state") {
      const state = await session.getState();
      return machineOrSummary(
        format,
        stateSummary(state),
        { success: true, state }
      );
    }

    if (name === "bga_session_get_players") {
      const players = await session.getPlayers();
      return machineOrSummary(
        format,
        `Fetched ${players.length} player slot(s).`,
        { success: true, players }
      );
    }

    if (name === "bga_session_get_gamedatas") {
      const gamedatas = await session.getGameDatas();
      return machineOrSummary(
        format,
        `Fetched game datas (${Object.keys(gamedatas).length} root key(s)).`,
        { success: true, gamedatas }
      );
    }

    if (name === "bga_session_perform_action") {
      const step = await session.performAction({
        playerId: Number(args.playerId),
        name: String(args.name),
        args: (args.args as Record<string, unknown> | undefined) ?? {},
      });
      const stepRecord = step as Record<string, unknown>;
      const stepAction =
        stepRecord.action && typeof stepRecord.action === "object"
          ? (stepRecord.action as Record<string, unknown>)
          : {};

      const notifications = Array.isArray(stepRecord.notifications)
        ? stepRecord.notifications
        : [];
      const rendered = notifications
        .map((n) => (n && typeof n === "object" ? String((n as Record<string, unknown>).logRendered ?? "") : ""))
        .filter((n) => n.length > 0)
        .slice(0, 5);

      const summaryLines = [
        stepRecord.success
          ? `Action ${String(stepAction.name ?? "")} succeeded.`
          : `Action ${String(stepAction.name ?? "")} failed: ${String(stepRecord.error ?? "unknown error")}`,
      ];
      if (rendered.length > 0) {
        summaryLines.push("Changes:");
        for (const line of rendered) {
          summaryLines.push(`- ${line}`);
        }
      }

      return machineOrSummary(
        format,
        summaryLines.join("\n"),
        { success: true, step }
      );
    }

    if (name === "bga_session_reset") {
      const state = await session.resetSession({
        seed: typeof args.seed === "number" ? args.seed : undefined,
      });
      return machineOrSummary(
        format,
        `Reset session ${id}.\n${stateSummary(state)}`,
        { success: true, state }
      );
    }

    if (name === "bga_session_timeline") {
      const timeline = session.getEventTimeline();
      return machineOrSummary(
        format,
        `Fetched ${timeline.length} timeline event(s).`,
        { success: true, timeline }
      );
    }

    if (name === "bga_session_warnings") {
      const warnings = session.getWarnings();
      return machineOrSummary(
        format,
        `Fetched ${warnings.length} warning record(s).`,
        { success: true, warnings }
      );
    }

    return {
      content: [{ type: "text", text: `Unknown bga-lite runtime tool: ${name}` }],
      isError: true,
    };
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    if (format === "machine") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: message,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}
