import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { WORKSPACE_PATH } from "../config.js";

// ---------------------------------------------------------------------------
// Error codes for machine payload mode
// ---------------------------------------------------------------------------

export const ErrorCode = {
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_STOPPED: "SESSION_STOPPED",
  HTTP_ERROR: "HTTP_ERROR",
  ACTION_REJECTED: "ACTION_REJECTED",
  INVALID_REQUEST: "INVALID_REQUEST",
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Shared types for state responses
// ---------------------------------------------------------------------------

export interface StateResponse {
  state_id?: number;
  name?: string;
  type?: string;
  description?: string;
  active_players?: number[];
  possibleactions?: string[];
  args?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Machine payload interface for structured API responses
// ---------------------------------------------------------------------------

export interface LegalMove {
  action: string;
  requires_args: boolean;
  move_count: number;
  source: 'action_options' | 'heuristic';
  label?: string;
  candidates?: Array<{ args?: Record<string, unknown>; label?: string }>;
}

export interface MachinePayload {
  success: boolean;
  state?: StateResponse;
  available_actions?: string[];
  legal_moves?: Record<string, LegalMove>;
  action_options?: Record<string, unknown>;
  notifications?: Array<{ log_rendered?: string; type?: string; log?: string }>;
  error?: string;
  error_code?: ErrorCodeType;
}

// ---------------------------------------------------------------------------
// Session registry
// ---------------------------------------------------------------------------

export interface SessionEntry {
  /** Opaque handle, e.g. "castlecombo:8091" */
  handle: string;
  /** Game directory name (basename), e.g. "castlecombo" */
  game: string;
  /** TCP port the bga-lite server is listening on */
  port: number;
  /** Number of player slots */
  players: number;
  /** Whether the subprocess is still alive */
  status: "running" | "stopped";
  /** Base URL, e.g. "http://localhost:8091" */
  baseUrl: string;
  /** The spawned child process */
  child: ChildProcess;
}

/** Module-level registry of all sessions started in this MCP server process. */
export const sessions = new Map<string, SessionEntry>();

// ---------------------------------------------------------------------------
// HTTP client helper
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;

export interface FetchOptions {
  method?: string;
  body?: string;
  timeoutMs?: number;
}

/**
 * Minimal HTTP client for bga-lite's JSON API.
 * Uses `node:http` (not the global `fetch`) so it works in all Node versions.
 * Returns the parsed JSON response body.
 * Rejects on network error, timeout, or non-2xx status.
 */
export function bgaLiteFetch(
  baseUrl: string,
  path: string,
  options: FetchOptions = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const method = options.method ?? "GET";
    const body = options.body;
    const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

    const reqOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port ? parseInt(url.port, 10) : 80,
      path: url.pathname + url.search,
      method,
      headers: {
        Accept: "application/json",
        ...(body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            }
          : {}),
      },
    };

    const req = http.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(
            new Error(
              `bga-lite HTTP ${status} for ${method} ${path}: ${raw.slice(0, 200)}`
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(
            new Error(
              `bga-lite returned non-JSON for ${method} ${path}: ${raw.slice(0, 200)}`
            )
          );
        }
      });
      res.on("error", reject);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new Error(`bga-lite request timed out after ${timeoutMs} ms: ${method} ${path}`)
      );
    });

    req.on("error", reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Port finder
// ---------------------------------------------------------------------------

/**
 * Find a free TCP port by attempting to bind a temporary server.
 * Tries `startFrom`, then `startFrom + 1`, etc. until one succeeds.
 */
export function findFreePort(startFrom: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let candidate = startFrom;

    function tryPort(port: number): void {
      const server = net.createServer();
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" || err.code === "EACCES") {
          // Port is taken — try the next one
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(port));
      });
    }

    tryPort(candidate);
  });
}

// ---------------------------------------------------------------------------
// Startup waiter
// ---------------------------------------------------------------------------

/**
 * Read lines from `child.stdout` until one parses as valid JSON (the startup
 * summary printed by bga-lite on successful startup), then resolve with that
 * parsed object.
 *
 * Rejects if `timeoutMs` elapses before a valid JSON line is seen, or if the
 * child process exits before printing one.
 */
export function waitForStartup(
  child: ChildProcess,
  timeoutMs: number
): Promise<object> {
  return new Promise((resolve, reject) => {
    if (!child.stdout) {
      reject(new Error("Child process has no stdout stream"));
      return;
    }

    let settled = false;
    let buffer = "";

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(
          new Error(
            `bga-lite did not print startup JSON within ${timeoutMs} ms`
          )
        );
      }
    }, timeoutMs);

    /**
     * Try to parse the accumulated buffer as JSON.
     * bga-lite prints JSON.stringify(info, null, 2) which spans multiple lines,
     * so we must try the whole buffer rather than individual lines.
     */
    function tryParseBuffer(): void {
      const trimmed = buffer.trim();
      if (!trimmed) return;
      // Find the first '{' and try to parse from there
      const start = trimmed.indexOf("{");
      if (start === -1) return;
      const candidate = trimmed.slice(start);
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === "object" && parsed !== null && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve(parsed as object);
        }
      } catch {
        // Incomplete JSON — keep accumulating
      }
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      tryParseBuffer();
    });

    child.stdout.on("end", () => {
      if (!settled) {
        tryParseBuffer();
      }
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(
            "bga-lite process stdout closed before printing startup JSON"
          )
        );
      }
    });

    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(
            `bga-lite process exited with code ${code} before printing startup JSON`
          )
        );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Tool definitions (populated by tasks 17.2–17.7)
// ---------------------------------------------------------------------------

export const gameplayTools: Tool[] = [
  // -------------------------------------------------------------------------
  // bga_session_start — task 17.2
  // -------------------------------------------------------------------------
  {
    name: "bga_session_start",
    description:
      "Start a local bga-lite server for a BGA game project. " +
      "Returns a session handle (e.g. 'castlecombo:8091') and the startup summary. " +
      "If a session with the same handle is already running, returns the existing one.",
    inputSchema: {
      type: "object",
      properties: {
        game: {
          type: "string",
          description:
            "Directory name of the BGA game project (e.g. 'castlecombo'). " +
            "Resolved relative to WORKSPACE_PATH env var (or process.cwd()).",
        },
        players: {
          type: "number",
          description: "Number of player slots (optional; defaults to game minimum).",
        },
        port: {
          type: "number",
          description:
            "TCP port for the bga-lite server (optional; 0 or omitted = auto-assign starting from 8090).",
        },
        reset: {
          type: "boolean",
          description:
            "If true, force a fresh session even if a persisted database exists.",
        },
      },
      required: ["game"],
    },
  },
  // -------------------------------------------------------------------------
  // bga_session_stop — task 17.3
  // -------------------------------------------------------------------------
  {
    name: "bga_session_stop",
    description:
      "Stop a running bga-lite server session. " +
      "Sends SIGTERM to the subprocess, waits 3 seconds, then sends SIGKILL if still running. " +
      "Removes the session from the registry.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description:
            "Session handle returned by bga_session_start (e.g. 'castlecombo:8091').",
        },
      },
      required: ["handle"],
    },
  },
  // -------------------------------------------------------------------------
  // bga_list_sessions — task 17.4
  // -------------------------------------------------------------------------
  {
    name: "bga_list_sessions",
    description:
      "List all bga-lite sessions currently managed by this MCP server. " +
      "For each running session, fetches the current state name (with a 3 s timeout; skips on error). " +
      "Returns an array of session summaries.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // -------------------------------------------------------------------------
  // bga_get_state — task 17.5
  // -------------------------------------------------------------------------
  {
    name: "bga_get_state",
    description:
      "Get the current game state for a running bga-lite session. " +
      "Returns a structured summary: state name, whose turn it is, available actions, and the state args. " +
      "In 'machine' format, returns a structured payload with error codes.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description:
            "Session handle returned by bga_session_start (e.g. 'castlecombo:8091').",
        },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description:
            "Output format: 'summary' (default) for human-readable text, or 'machine' for structured JSON payload.",
        },
      },
      required: ["handle"],
    },
  },
  // -------------------------------------------------------------------------
  // bga_perform_action — task 17.6
  // -------------------------------------------------------------------------
  {
    name: "bga_perform_action",
    description:
      "Perform a player action in a running bga-lite session. " +
      "Returns a 'what changed' summary: whether the action succeeded, rendered notifications, " +
      "the new state, and any error message on failure. " +
      "In 'machine' format, returns a structured payload with error codes.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Session handle (e.g. 'castlecombo:8091').",
        },
        player_id: {
          type: "number",
          description: "The ID of the player performing the action.",
        },
        action: {
          type: "string",
          description: "The action method name (e.g. 'actChooseCard').",
        },
        args: {
          type: "object",
          description: "Optional arguments for the action (e.g. { card_id: 42 }).",
        },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description:
            "Output format: 'summary' (default) for human-readable text, or 'machine' for structured JSON payload.",
        },
      },
      required: ["handle", "player_id", "action"],
    },
  },
  // -------------------------------------------------------------------------
  // bga_reset_session — task 17.7
  // -------------------------------------------------------------------------
  {
    name: "bga_reset_session",
    description:
      "Reset a bga-lite session to its initial state. " +
      "Drops and recreates the database, calls setupNewGame(), and returns the new initial state summary. " +
      "In 'machine' format, returns a structured payload with error codes.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Session handle (e.g. 'castlecombo:8091').",
        },
        format: {
          type: "string",
          enum: ["summary", "machine"],
          description:
            "Output format: 'summary' (default) for human-readable text, or 'machine' for structured JSON payload.",
        },
      },
      required: ["handle"],
    },
  },
  // -------------------------------------------------------------------------
  // bga_save_snapshot — task 28
  // -------------------------------------------------------------------------
  {
    name: "bga_save_snapshot",
    description:
      "Save a snapshot of the current game session database for deterministic replay. " +
      "Returns snapshot metadata including ID, timestamp, and current game state.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Session handle (e.g. 'seaside:8091').",
        },
        name: {
          type: "string",
          description: "Optional human-readable name for the snapshot (e.g. 'before endgame').",
        },
        note: {
          type: "string",
          description: "Optional detailed note describing the snapshot context.",
        },
      },
      required: ["handle"],
    },
  },
  // -------------------------------------------------------------------------
  // bga_load_snapshot — task 28
  // -------------------------------------------------------------------------
  {
    name: "bga_load_snapshot",
    description:
      "Restore a session to a previously saved snapshot. " +
      "Replaces the current database with the saved one and returns the restored state.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Session handle (e.g. 'seaside:8091').",
        },
        snapshot_id: {
          type: "string",
          description: "Snapshot ID (e.g. '1705000000000') or name to restore.",
        },
      },
      required: ["handle", "snapshot_id"],
    },
  },
  // -------------------------------------------------------------------------
  // bga_list_snapshots — task 28
  // -------------------------------------------------------------------------
  {
    name: "bga_list_snapshots",
    description:
      "List all snapshots available for a session. " +
      "Returns snapshot metadata including timestamps, states, and sizes.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Session handle (e.g. 'seaside:8091').",
        },
      },
      required: ["handle"],
    },
  },
  // -------------------------------------------------------------------------
  // bga_delete_snapshot — task 28
  // -------------------------------------------------------------------------
  {
    name: "bga_delete_snapshot",
    description:
      "Delete a saved snapshot from a session. " +
      "Removes both the database backup and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Session handle (e.g. 'seaside:8091').",
        },
        snapshot_id: {
          type: "string",
          description: "Snapshot ID (e.g. '1705000000000') or name to delete.",
        },
      },
      required: ["handle", "snapshot_id"],
    },
  },
  // -------------------------------------------------------------------------
  // bga_suggest_actions — task 29
  // -------------------------------------------------------------------------
  {
    name: "bga_suggest_actions",
    description:
      "Get ranked action suggestions for the current game state using deterministic heuristics. " +
      "Returns available actions scored by availability, branching factor, scoring signals, and progression hints. " +
      "This is advisory-only and never performs actions directly.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Session handle (e.g. 'seaside:8091').",
        },
        objective: {
          type: "string",
          description: "Optional objective to bias action ranking (e.g. 'maximize score').",
        },
      },
      required: ["handle"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function handleGameplayTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  if (name === "bga_session_start") {
    return handleSessionStart(args);
  }

  if (name === "bga_session_stop") {
    return handleSessionStop(args);
  }

  if (name === "bga_list_sessions") {
    return handleListSessions();
  }

  if (name === "bga_get_state") {
    return handleGetState(args);
  }

  if (name === "bga_perform_action") {
    return handlePerformAction(args);
  }

  if (name === "bga_reset_session") {
    return handleResetSession(args);
  }

  if (name === "bga_save_snapshot") {
    return handleSaveSnapshot(args);
  }

  if (name === "bga_load_snapshot") {
    return handleLoadSnapshot(args);
  }

  if (name === "bga_list_snapshots") {
    return handleListSnapshots(args);
  }

  if (name === "bga_delete_snapshot") {
    return handleDeleteSnapshot(args);
  }

  if (name === "bga_suggest_actions") {
    return handleSuggestActions(args);
  }

  return {
    content: [{ type: "text", text: `Unknown gameplay tool: ${name}` }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// bga_session_start implementation
// ---------------------------------------------------------------------------

async function handleSessionStart(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const game = args.game as string;
  const playersArg = args.players as number | undefined;
  const portArg = args.port as number | undefined;
  const resetArg = args.reset as boolean | undefined;

  // 1. Resolve workspace root and game directory
  const workspaceRoot = WORKSPACE_PATH ?? process.cwd();
  const gameDirCandidates = path.isAbsolute(game)
    ? [game]
    : [
        path.join(workspaceRoot, game),
        path.join(workspaceRoot, "..", game),
      ];

  const gameDir = gameDirCandidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "gameinfos.inc.php"))
  );

  // 2. Validate game directory contains gameinfos.inc.php
  if (!gameDir) {
    return {
      content: [
        {
          type: "text",
          text:
            `Error: Could not resolve game directory for '${game}' with gameinfos.inc.php. ` +
            `Checked: ${gameDirCandidates.join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  // 3. Resolve port — auto-assign if 0 or omitted
  const resolvedPort =
    portArg && portArg > 0 ? portArg : await findFreePort(8090);

  // 4. Build handle and check registry for existing running session
  const handle = `${game}:${resolvedPort}`;
  const existing = sessions.get(handle);
  if (existing && existing.status === "running") {
    return {
      content: [
        {
          type: "text",
          text:
            `Session already running.\n` +
            `Handle: ${handle}\n` +
            `URL: ${existing.baseUrl}\n` +
            `Game: ${existing.game}\n` +
            `Players: ${existing.players}`,
        },
      ],
    };
  }

  // 5. Build CLI args for bga-lite
  const bgaLiteBinCandidates = [
    path.join(workspaceRoot, "bga-lite", "bin", "bga-lite.js"),
    path.join(workspaceRoot, "..", "bga-lite", "bin", "bga-lite.js"),
  ];
  const bgaLiteBin = bgaLiteBinCandidates.find((candidate) => fs.existsSync(candidate));

  if (!bgaLiteBin) {
    return {
      content: [
        {
          type: "text",
          text:
            `Error: Could not find bga-lite CLI binary. ` +
            `Checked: ${bgaLiteBinCandidates.join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  const spawnArgs: string[] = [
    bgaLiteBin,
    "--game", gameDir,
    "--port", String(resolvedPort),
  ];
  if (playersArg !== undefined) {
    spawnArgs.push("--players", String(playersArg));
  }
  if (resetArg) {
    spawnArgs.push("--reset");
  }

  // 6. Spawn the bga-lite process
  let child: ChildProcess;
  try {
    child = spawn("node", spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to spawn bga-lite: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  // 7. Wait for startup JSON on stdout
  let startupData: Record<string, unknown>;
  try {
    startupData = (await waitForStartup(child, 30_000)) as Record<string, unknown>;
  } catch (err) {
    // Collect any stderr for diagnostics
    let stderrOutput = "";
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrOutput += chunk;
      });
    }
    child.kill();
    return {
      content: [
        {
          type: "text",
          text:
            `bga-lite failed to start: ${(err as Error).message}\n` +
            (stderrOutput ? `stderr: ${stderrOutput.slice(0, 500)}` : ""),
        },
      ],
      isError: true,
    };
  }

  // 8. Determine player count from startup data (fallback to arg or 2)
  const playerCount =
    typeof startupData.players === "number"
      ? startupData.players
      : (playersArg ?? 2);

  const baseUrl =
    typeof startupData.url === "string"
      ? startupData.url
      : `http://localhost:${resolvedPort}`;

  // 9. Register session
  const entry: SessionEntry = {
    handle,
    game,
    port: resolvedPort,
    players: playerCount,
    status: "running",
    baseUrl,
    child,
  };
  sessions.set(handle, entry);

  // 10. Listen for unexpected exit and mark session stopped
  child.on("exit", () => {
    const sess = sessions.get(handle);
    if (sess) {
      sess.status = "stopped";
    }
  });

  // 11. Build response summary
  const endpointsStr = startupData.endpoints
    ? "\nEndpoints: " + JSON.stringify(startupData.endpoints, null, 2)
    : "";

  const summary =
    `Session started.\n` +
    `Handle: ${handle}\n` +
    `URL: ${baseUrl}\n` +
    `Game: ${game}\n` +
    `Players: ${playerCount}` +
    endpointsStr;

  return {
    content: [{ type: "text", text: summary }],
  };
}

// ---------------------------------------------------------------------------
// bga_session_stop implementation
// ---------------------------------------------------------------------------

async function handleSessionStop(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handle = args.handle as string;

  // 1. Look up handle in registry; return error if not found
  const session = sessions.get(handle);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `Error: No session found with handle '${handle}'. ` +
            `Use bga_list_sessions to see active sessions.`,
        },
      ],
      isError: true,
    };
  }

  const { child } = session;

  // 2. Send SIGTERM; wait 3 s; send SIGKILL if still running
  child.kill("SIGTERM");

  await new Promise<void>((resolve) => setTimeout(resolve, 3000));

  // exitCode === null means the process is still running
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }

  // 3. Remove from registry; return confirmation
  sessions.delete(handle);

  return {
    content: [
      {
        type: "text",
        text: `Session '${handle}' stopped successfully.`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Shared helper: format a /state response into a human-readable summary
// ---------------------------------------------------------------------------

/**
 * bga-lite endpoints often return an envelope { success, state: {...} }.
 * Normalize both wrapped and raw payload shapes to a plain StateResponse.
 */
function normalizeStatePayload(payload: unknown): StateResponse {
  if (!payload || typeof payload !== "object") return {};
  const asRecord = payload as Record<string, unknown>;
  const wrapped = asRecord.state;
  if (wrapped && typeof wrapped === "object") {
    return wrapped as StateResponse;
  }
  return asRecord as StateResponse;
}

function formatStateSummary(
  state: StateResponse,
  players: Map<number, string>
): string {
  const stateName = state.name ?? "(unknown)";
  const stateId = state.state_id ?? "?";
  const description = state.description ?? "";
  const activePlayers = state.active_players ?? [];
  const possibleActions = state.possibleactions ?? [];
  const args = state.args ?? {};

  // Resolve active player names
  const activePlayerDescs = activePlayers.map((id) => {
    const name = players.get(id) ?? `Player ${id}`;
    return `${name} (ID: ${id})`;
  });

  const lines: string[] = [
    `State: ${stateName} (ID: ${stateId})`,
  ];

  if (description) {
    lines.push(`Description: ${description}`);
  }

  if (activePlayerDescs.length > 0) {
    lines.push(`Active player: ${activePlayerDescs.join(", ")}`);
  }

  if (possibleActions.length > 0) {
    lines.push(`Available actions: ${possibleActions.join(", ")}`);
  }

  if (Object.keys(args).length > 0) {
    lines.push(`Args: ${JSON.stringify(args, null, 2)}`);
  }

  return lines.join("\n");
}

/** Build a player-id → name map from the session's player list. */
function buildPlayerMap(session: SessionEntry): Map<number, string> {
  // We don't store player names in SessionEntry directly, but we can
  // fetch them from the session's baseUrl if needed. For now we use
  // a synthetic map based on player count.
  const map = new Map<number, string>();
  // Player IDs are synthetic starting at 1000001
  for (let i = 0; i < session.players; i++) {
    map.set(1000001 + i, `Player ${i + 1}`);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Machine mode response helpers
// ---------------------------------------------------------------------------

/**
 * Convert a handler response to machine format if requested.
 * For text content responses, returns wrapped in MachinePayload if format === "machine".
 */
function toMachinePayload(
  format: string | undefined,
  payload: MachinePayload
): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  if (format === "machine") {
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: !payload.success,
    };
  }
  // For summary format, return empty/error indication (caller handles text)
  return { content: [{ type: "text", text: "" }], isError: false };
}

/**
 * Create an error payload in machine format.
 */
function errorPayload(
  errorCode: ErrorCodeType,
  message: string
): MachinePayload {
  return {
    success: false,
    error: message,
    error_code: errorCode,
  };
}

/**
 * Extract legal moves from a game state and action_options.
 * Returns a map keyed by action name with metadata about each move.
 */
function extractLegalMoves(state: StateResponse): Record<string, LegalMove> {
  const legalMoves: Record<string, LegalMove> = {};
  const actions = state.possibleactions ?? [];
  const actionOptions = (state.args as Record<string, unknown>) ?? {};

  for (const action of actions) {
    const actionOption = actionOptions[action];
    
    if (actionOption && typeof actionOption === "object") {
      const optObj = actionOption as Record<string, unknown>;
      const possibleMoves = optObj.possibleMoves as Array<Record<string, unknown>> | undefined;
      const label = optObj.label as string | undefined;
      
      if (possibleMoves && Array.isArray(possibleMoves)) {
        // Action has explicit possible moves
        legalMoves[action] = {
          action,
          requires_args: possibleMoves.length > 0,
          move_count: possibleMoves.length,
          source: "action_options",
          label,
          candidates: possibleMoves.map((move) => ({
            args: move,
            label: (move.label as string | undefined),
          })),
        };
      } else if (label) {
        // Action has metadata but no explicit moves
        legalMoves[action] = {
          action,
          requires_args: true,
          move_count: 0,
          source: "action_options",
          label,
        };
      } else {
        // Action exists but no metadata
        legalMoves[action] = {
          action,
          requires_args: false,
          move_count: 1,
          source: "heuristic",
        };
      }
    } else {
      // Action not found in action_options; treat as simple no-arg action
      legalMoves[action] = {
        action,
        requires_args: false,
        move_count: 1,
        source: "heuristic",
      };
    }
  }

  return legalMoves;
}

/**
 * Score and rank actions using deterministic heuristics.
 * Returns suggestions sorted by score (descending).
 */
function suggestActions(
  legalMoves: Record<string, LegalMove>,
  objective?: string
): ActionSuggestion[] {
  const suggestions: ActionSuggestion[] = [];

  for (const [actionName, move] of Object.entries(legalMoves)) {
    let score = 10; // Base availability score
    const reasons: string[] = [];

    // 1. Branching factor heuristic
    if (move.move_count === 1) {
      score += 5;
      reasons.push("Single mandatory move");
    } else if (move.move_count >= 2 && move.move_count <= 3) {
      score += 8;
      reasons.push(`Typical choice (${move.move_count} options)`);
    } else if (move.move_count > 3) {
      score += 6;
      reasons.push(`Complex decision (${move.move_count} options)`);
    }

    // 2. Check for scoring signals in action name/label
    const combinedText = `${actionName} ${move.label ?? ""}`.toLowerCase();
    if (combinedText.includes("score") || combinedText.includes("point")) {
      score += 3;
      reasons.push("Scoring opportunity detected");
    }

    // 3. Check for progression signals
    if (
      combinedText.includes("level") ||
      combinedText.includes("round") ||
      combinedText.includes("turn") ||
      combinedText.includes("phase")
    ) {
      score += 2;
      reasons.push("Progression milestone detected");
    }

    if (combinedText.includes("end") || combinedText.includes("final")) {
      score += 1;
      reasons.push("End-of-phase action");
    }

    // 4. Objective matching (if provided)
    if (objective) {
      const objectiveLower = objective.toLowerCase();
      if (combinedText.includes(objectiveLower)) {
        score += 5;
        reasons.push(`Matches objective: ${objective}`);
      }
    }

    // 5. Determine confidence based on score and move availability
    let confidence: "high" | "medium" | "low" = "low";
    if (score >= 20) {
      confidence = "high";
    } else if (score >= 15) {
      confidence = "medium";
    }

    if (move.move_count === 1) {
      confidence = "high"; // Forced moves are high confidence
    }

    suggestions.push({
      action: actionName,
      score,
      confidence,
      reasons,
      legal_moves_info: move,
    });
  }

  // Sort by score descending, then by action name for determinism
  suggestions.sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));

  return suggestions;
}

// ---------------------------------------------------------------------------
// Snapshot support (task 28)
// ---------------------------------------------------------------------------

export interface SnapshotMetadata {
  id: string;
  name?: string;
  timestamp: number;
  state_id: number;
  state_name: string;
  active_player?: number;
  note?: string;
}

export interface SnapshotInfo extends SnapshotMetadata {
  size_bytes: number;
}

// ---------------------------------------------------------------------------
// Action suggestion support (task 29)
// ---------------------------------------------------------------------------

export interface ActionSuggestion {
  action: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  legal_moves_info: LegalMove;
}

/**
 * Get the snapshots directory for a session.
 * Creates the directory if it doesn't exist.
 */
function getSnapshotsDir(session: SessionEntry): string {
  // Snapshots stored in process.cwd()/session/.snapshots/{game}_{port}/
  const snapshotsDir = path.join(
    process.cwd(),
    "session",
    ".snapshots",
    `${session.game}_${session.port}`
  );
  
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }
  
  return snapshotsDir;
}

/**
 * Fetch the current game state to include in snapshot metadata.
 */
async function fetchCurrentStateForSnapshot(
  session: SessionEntry
): Promise<SnapshotMetadata["state_id"] | null> {
  try {
    const raw = await bgaLiteFetch(session.baseUrl, "/state", {
      timeoutMs: 3000,
    });
    const stateResp = normalizeStatePayload(raw);
    return stateResp.state_id ?? 0;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// bga_list_sessions implementation (task 17.4)
// ---------------------------------------------------------------------------

async function handleListSessions(): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}> {
  if (sessions.size === 0) {
    return {
      content: [{ type: "text", text: "No sessions are currently managed by this MCP server." }],
    };
  }

  const results: Array<{
    handle: string;
    game: string;
    port: number;
    players: number;
    status: string;
    currentState?: string;
  }> = [];

  for (const [, session] of sessions) {
    const entry: (typeof results)[number] = {
      handle: session.handle,
      game: session.game,
      port: session.port,
      players: session.players,
      status: session.status,
    };

    if (session.status === "running") {
      try {
        const raw = await bgaLiteFetch(session.baseUrl, "/state", {
          timeoutMs: 3000,
        });
        const stateResp = normalizeStatePayload(raw);
        entry.currentState = stateResp.name ?? "(unknown)";
      } catch {
        // Skip state fetch on error — session may be starting up or unresponsive
      }
    }

    results.push(entry);
  }

  const lines = results.map((r) => {
    const stateStr = r.currentState ? `, state: ${r.currentState}` : "";
    return `• ${r.handle} — game: ${r.game}, port: ${r.port}, players: ${r.players}, status: ${r.status}${stateStr}`;
  });

  return {
    content: [
      {
        type: "text",
        text: `Sessions (${results.length}):\n${lines.join("\n")}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// bga_get_state implementation (task 17.5)
// ---------------------------------------------------------------------------

async function handleGetState(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handle = args.handle as string;
  const format = (args.format as string | undefined) ?? "summary";

  const session = sessions.get(handle);
  if (!session) {
    const payload = errorPayload(ErrorCode.SESSION_NOT_FOUND,
      `No session found with handle '${handle}'. Use bga_list_sessions to see active sessions.`);
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${payload.error}`,
        },
      ],
      isError: true,
    };
  }

  if (session.status === "stopped") {
    const payload = errorPayload(ErrorCode.SESSION_STOPPED,
      `Session '${handle}' has stopped. Start a new session with bga_session_start.`);
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${payload.error}`,
        },
      ],
      isError: true,
    };
  }

  let stateResp: StateResponse;
  try {
    const raw = await bgaLiteFetch(session.baseUrl, "/state");
    stateResp = normalizeStatePayload(raw);
  } catch (err) {
    const payload = errorPayload(ErrorCode.HTTP_ERROR,
      `Error fetching state from session '${handle}': ${(err as Error).message}`);
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${payload.error}`,
        },
      ],
      isError: true,
    };
  }

  if (format === "machine") {
    const payload: MachinePayload = {
      success: true,
      state: stateResp,
      available_actions: stateResp.possibleactions,
      legal_moves: extractLegalMoves(stateResp),
    };
    return toMachinePayload(format, payload);
  }

  const playerMap = buildPlayerMap(session);
  const summary = formatStateSummary(stateResp, playerMap);

  return {
    content: [{ type: "text", text: summary }],
  };
}

// ---------------------------------------------------------------------------
// bga_perform_action implementation (task 17.6)
// ---------------------------------------------------------------------------

async function handlePerformAction(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handle = args.handle as string;
  const playerId = args.player_id as number;
  const action = args.action as string;
  const actionArgs = (args.args as Record<string, unknown> | undefined) ?? {};
  const format = (args.format as string | undefined) ?? "summary";

  const session = sessions.get(handle);
  if (!session) {
    const payload = errorPayload(ErrorCode.SESSION_NOT_FOUND,
      `No session found with handle '${handle}'. Use bga_list_sessions to see active sessions.`);
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${payload.error}`,
        },
      ],
      isError: true,
    };
  }

  if (session.status === "stopped") {
    const payload = errorPayload(ErrorCode.SESSION_STOPPED,
      `Session '${handle}' has stopped. Start a new session with bga_session_start.`);
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${payload.error}`,
        },
      ],
      isError: true,
    };
  }

  interface ActionResponse {
    success: boolean;
    notifications?: Array<{ log_rendered?: string; type?: string; log?: string }>;
    state?: StateResponse;
    error?: string;
    available_actions?: string[];
  }

  let actionResp: ActionResponse;
  try {
    actionResp = (await bgaLiteFetch(session.baseUrl, "/action", {
      method: "POST",
      body: JSON.stringify({ player_id: playerId, action, args: actionArgs }),
    })) as ActionResponse;
  } catch (err) {
    const payload = errorPayload(ErrorCode.HTTP_ERROR,
      `Error performing action '${action}' in session '${handle}': ${(err as Error).message}`);
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${payload.error}`,
        },
      ],
      isError: true,
    };
  }

  const playerMap = buildPlayerMap(session);

  if (!actionResp.success) {
    const payload: MachinePayload = {
      success: false,
      error: actionResp.error ?? "Action rejected",
      error_code: ErrorCode.ACTION_REJECTED,
      available_actions: actionResp.available_actions,
      legal_moves: actionResp.state ? extractLegalMoves(actionResp.state) : undefined,
    };
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    const availableActions = actionResp.available_actions ?? [];
    const lines: string[] = [
      `Action failed: ${actionResp.error ?? "Unknown error"}`,
    ];
    if (availableActions.length > 0) {
      lines.push(`Available actions: ${availableActions.join(", ")}`);
    }
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      isError: true,
    };
  }

  // Extract log_rendered strings from notifications
  const notifications = actionResp.notifications ?? [];
  const changes = notifications
    .map((n) => n.log_rendered)
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);

  if (format === "machine") {
    const payload: MachinePayload = {
      success: true,
      state: actionResp.state,
      available_actions: actionResp.available_actions,
      legal_moves: actionResp.state ? extractLegalMoves(actionResp.state) : undefined,
      notifications: actionResp.notifications,
    };
    return toMachinePayload(format, payload);
  }

  const newState = actionResp.state;
  const lines: string[] = ["Action succeeded."];

  if (changes.length > 0) {
    lines.push("\nWhat changed:");
    for (const change of changes) {
      lines.push(`  • ${change}`);
    }
  }

  if (newState) {
    lines.push("\nNew state:");
    lines.push(formatStateSummary(newState, playerMap));
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

// ---------------------------------------------------------------------------
// bga_reset_session implementation (task 17.7)
// ---------------------------------------------------------------------------

async function handleResetSession(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handle = args.handle as string;
  const format = (args.format as string | undefined) ?? "summary";

  const session = sessions.get(handle);
  if (!session) {
    const payload = errorPayload(ErrorCode.SESSION_NOT_FOUND,
      `No session found with handle '${handle}'. Use bga_list_sessions to see active sessions.`);
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${payload.error}`,
        },
      ],
      isError: true,
    };
  }

  if (session.status === "stopped") {
    const payload = errorPayload(ErrorCode.SESSION_STOPPED,
      `Session '${handle}' has stopped. Start a new session with bga_session_start.`);
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${payload.error}`,
        },
      ],
      isError: true,
    };
  }

  let resetResp: StateResponse;
  try {
    const raw = await bgaLiteFetch(session.baseUrl, "/reset", {
      method: "POST",
      body: "{}",
    });
    resetResp = normalizeStatePayload(raw);
  } catch (err) {
    const payload = errorPayload(ErrorCode.HTTP_ERROR,
      `Error resetting session '${handle}': ${(err as Error).message}`);
    if (format === "machine") {
      return toMachinePayload(format, payload);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${payload.error}`,
        },
      ],
      isError: true,
    };
  }

  if (format === "machine") {
    const payload: MachinePayload = {
      success: true,
      state: resetResp,
      available_actions: resetResp.possibleactions,
      legal_moves: extractLegalMoves(resetResp),
    };
    return toMachinePayload(format, payload);
  }

  const playerMap = buildPlayerMap(session);
  const summary = formatStateSummary(resetResp, playerMap);

  return {
    content: [
      {
        type: "text",
        text: `Session '${handle}' reset successfully.\n\n${summary}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// bga_save_snapshot implementation (task 28)
// ---------------------------------------------------------------------------

async function handleSaveSnapshot(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handle = args.handle as string;
  const name = (args.name as string | undefined);
  const note = (args.note as string | undefined);

  const session = sessions.get(handle);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `Error: No session found with handle '${handle}'.`,
        },
      ],
      isError: true,
    };
  }

  if (session.status === "stopped") {
    return {
      content: [
        {
          type: "text",
          text: `Error: Session '${handle}' has stopped.`,
        },
      ],
      isError: true,
    };
  }

  try {
    // Get current state for metadata
    const stateId = await fetchCurrentStateForSnapshot(session) ?? 0;
    
    // Create snapshot ID from timestamp
    const snapshotId = Date.now().toString();
    
    // Get snapshots directory
    const snapshotsDir = getSnapshotsDir(session);
    const dbCopyPath = path.join(snapshotsDir, `${snapshotId}.db`);
    const metadataPath = path.join(snapshotsDir, `${snapshotId}.json`);

    // Copy database file
    // We need to get the database path - it's typically session/{gameName}.db
    const dbPath = path.join(process.cwd(), "session", `${session.game}.db`);
    if (!fs.existsSync(dbPath)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Database file not found at ${dbPath}`,
          },
        ],
        isError: true,
      };
    }

    fs.copyFileSync(dbPath, dbCopyPath);

    // Write metadata
    const metadata: SnapshotMetadata = {
      id: snapshotId,
      name,
      timestamp: Date.now(),
      state_id: stateId,
      state_name: "(fetching...)",
      note,
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return {
      content: [
        {
          type: "text",
          text:
            `Snapshot saved successfully.\n` +
            `ID: ${snapshotId}\n` +
            `Name: ${name ?? "(unnamed)"}\n` +
            `State ID: ${stateId}\n` +
            `Size: ${(fs.statSync(dbCopyPath).size / 1024).toFixed(2)} KB`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error saving snapshot: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// bga_load_snapshot implementation (task 28)
// ---------------------------------------------------------------------------

async function handleLoadSnapshot(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handle = args.handle as string;
  const snapshotId = args.snapshot_id as string;

  const session = sessions.get(handle);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `Error: No session found with handle '${handle}'.`,
        },
      ],
      isError: true,
    };
  }

  if (session.status === "stopped") {
    return {
      content: [
        {
          type: "text",
          text: `Error: Session '${handle}' has stopped.`,
        },
      ],
      isError: true,
    };
  }

  try {
    const snapshotsDir = getSnapshotsDir(session);
    
    // Try to find snapshot by ID or name
    let foundId = snapshotId;
    let dbCopyPath = path.join(snapshotsDir, `${snapshotId}.db`);
    
    if (!fs.existsSync(dbCopyPath)) {
      // Try to find by name
      const files = fs.readdirSync(snapshotsDir);
      const matching = files
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({
          id: f.replace(".json", ""),
          path: path.join(snapshotsDir, f),
        }))
        .find((m) => {
          const meta = JSON.parse(fs.readFileSync(m.path, "utf8"));
          return meta.name === snapshotId;
        });
      
      if (matching) {
        foundId = matching.id;
        dbCopyPath = path.join(snapshotsDir, `${foundId}.db`);
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Error: Snapshot '${snapshotId}' not found.`,
            },
          ],
          isError: true,
        };
      }
    }

    // Restore database
    const dbPath = path.join(process.cwd(), "session", `${session.game}.db`);
    fs.copyFileSync(dbCopyPath, dbPath);

    // Fetch new state after restoration
    const stateId = await fetchCurrentStateForSnapshot(session) ?? 0;

    return {
      content: [
        {
          type: "text",
          text:
            `Snapshot restored successfully.\n` +
            `Snapshot ID: ${foundId}\n` +
            `Current State ID: ${stateId}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error loading snapshot: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// bga_list_snapshots implementation (task 28)
// ---------------------------------------------------------------------------

async function handleListSnapshots(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handle = args.handle as string;

  const session = sessions.get(handle);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `Error: No session found with handle '${handle}'.`,
        },
      ],
      isError: true,
    };
  }

  try {
    const snapshotsDir = getSnapshotsDir(session);
    const files = fs.readdirSync(snapshotsDir);
    const snapshots: SnapshotInfo[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        const metadataPath = path.join(snapshotsDir, file);
        const metadata = JSON.parse(
          fs.readFileSync(metadataPath, "utf8")
        ) as SnapshotMetadata;

        const dbPath = path.join(snapshotsDir, `${metadata.id}.db`);
        const size_bytes = fs.existsSync(dbPath)
          ? fs.statSync(dbPath).size
          : 0;

        snapshots.push({
          ...metadata,
          size_bytes,
        });
      }
    }

    // Sort by timestamp descending
    snapshots.sort((a, b) => b.timestamp - a.timestamp);

    if (snapshots.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No snapshots found for session '${handle}'.`,
          },
        ],
      };
    }

    const lines: string[] = [`Snapshots for ${handle} (${snapshots.length}):`];
    for (const snap of snapshots) {
      const date = new Date(snap.timestamp).toISOString();
      const sizeKb = (snap.size_bytes / 1024).toFixed(2);
      const nameStr = snap.name ? ` — ${snap.name}` : "";
      lines.push(
        `  • ID: ${snap.id}${nameStr}\n` +
        `    State: ${snap.state_name} (ID: ${snap.state_id}), Size: ${sizeKb} KB, Created: ${date}`
      );
    }

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error listing snapshots: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// bga_delete_snapshot implementation (task 28)
// ---------------------------------------------------------------------------

async function handleDeleteSnapshot(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handle = args.handle as string;
  const snapshotId = args.snapshot_id as string;

  const session = sessions.get(handle);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `Error: No session found with handle '${handle}'.`,
        },
      ],
      isError: true,
    };
  }

  try {
    const snapshotsDir = getSnapshotsDir(session);
    
    // Try to find snapshot by ID or name
    let foundId = snapshotId;
    let dbPath = path.join(snapshotsDir, `${snapshotId}.db`);
    let metadataPath = path.join(snapshotsDir, `${snapshotId}.json`);

    if (!fs.existsSync(metadataPath)) {
      // Try to find by name
      const files = fs.readdirSync(snapshotsDir);
      const matching = files
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({
          id: f.replace(".json", ""),
          path: path.join(snapshotsDir, f),
        }))
        .find((m) => {
          const meta = JSON.parse(fs.readFileSync(m.path, "utf8"));
          return meta.name === snapshotId;
        });

      if (matching) {
        foundId = matching.id;
        dbPath = path.join(snapshotsDir, `${foundId}.db`);
        metadataPath = path.join(snapshotsDir, `${foundId}.json`);
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Error: Snapshot '${snapshotId}' not found.`,
            },
          ],
          isError: true,
        };
      }
    }

    // Delete both database and metadata files
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
    }

    return {
      content: [
        {
          type: "text",
          text: `Snapshot '${foundId}' deleted successfully.`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error deleting snapshot: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// bga_suggest_actions implementation (task 29)
// ---------------------------------------------------------------------------

async function handleSuggestActions(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handle = args.handle as string;
  const objective = (args.objective as string | undefined);

  const session = sessions.get(handle);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `Error: No session found with handle '${handle}'.`,
        },
      ],
      isError: true,
    };
  }

  if (session.status === "stopped") {
    return {
      content: [
        {
          type: "text",
          text: `Error: Session '${handle}' has stopped.`,
        },
      ],
      isError: true,
    };
  }

  let stateResp: StateResponse;
  try {
    const raw = await bgaLiteFetch(session.baseUrl, "/state");
    stateResp = normalizeStatePayload(raw);
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error fetching state from session '${handle}': ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  // Extract legal moves and generate suggestions
  const legalMoves = extractLegalMoves(stateResp);
  const suggestions = suggestActions(legalMoves, objective);

  if (suggestions.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No actions available for session '${handle}'.`,
        },
      ],
    };
  }

  // Format suggestions for human-readable output
  const lines: string[] = [
    `Action Suggestions for ${handle}${objective ? ` (objective: ${objective})` : ""}:`,
    "",
  ];

  for (let i = 0; i < suggestions.length; i++) {
    const sugg = suggestions[i];
    const rank = i + 1;
    lines.push(
      `${rank}. ${sugg.action} (score: ${sugg.score}, confidence: ${sugg.confidence})`
    );

    if (sugg.legal_moves_info.label) {
      lines.push(`   Label: ${sugg.legal_moves_info.label}`);
    }

    lines.push(`   Reasons: ${sugg.reasons.join("; ")}`);

    if (sugg.legal_moves_info.move_count > 0) {
      lines.push(`   Options: ${sugg.legal_moves_info.move_count}`);
    }

    if (i < suggestions.length - 1) {
      lines.push("");
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
