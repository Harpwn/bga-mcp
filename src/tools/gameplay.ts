import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

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
      "Returns a structured summary: state name, whose turn it is, available actions, and the state args.",
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
  // bga_perform_action — task 17.6
  // -------------------------------------------------------------------------
  {
    name: "bga_perform_action",
    description:
      "Perform a player action in a running bga-lite session. " +
      "Returns a 'what changed' summary: whether the action succeeded, rendered notifications, " +
      "the new state, and any error message on failure.",
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
      "Drops and recreates the database, calls setupNewGame(), and returns the new initial state summary.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Session handle (e.g. 'castlecombo:8091').",
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
  const workspaceRoot = process.env.WORKSPACE_PATH ?? process.cwd();
  const gameDir = path.join(workspaceRoot, game);

  // 2. Validate game directory contains gameinfos.inc.php
  const gameInfoPath = path.join(gameDir, "gameinfos.inc.php");
  if (!fs.existsSync(gameInfoPath)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Game directory '${gameDir}' does not contain gameinfos.inc.php. ` +
            `Make sure '${game}' is a valid BGA game project directory.`,
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
  const bgaLiteBin = path.join(workspaceRoot, "bga-lite", "bin", "bga-lite.js");
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

interface StateResponse {
  state_id?: number;
  name?: string;
  type?: string;
  description?: string;
  active_players?: number[];
  possibleactions?: string[];
  args?: Record<string, unknown>;
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
        const stateResp = (await bgaLiteFetch(session.baseUrl, "/state", {
          timeoutMs: 3000,
        })) as StateResponse;
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

  const session = sessions.get(handle);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text:
            `Error: No session found with handle '${handle}'. ` +
            `Use bga_list_sessions to see active sessions.`,
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
          text: `Error: Session '${handle}' has stopped. Start a new session with bga_session_start.`,
        },
      ],
      isError: true,
    };
  }

  let stateResp: StateResponse;
  try {
    stateResp = (await bgaLiteFetch(session.baseUrl, "/state")) as StateResponse;
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

  const session = sessions.get(handle);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text:
            `Error: No session found with handle '${handle}'. ` +
            `Use bga_list_sessions to see active sessions.`,
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
          text: `Error: Session '${handle}' has stopped. Start a new session with bga_session_start.`,
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
    return {
      content: [
        {
          type: "text",
          text: `Error performing action '${action}' in session '${handle}': ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  const playerMap = buildPlayerMap(session);

  if (!actionResp.success) {
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

  // Extract log_rendered strings from notifications as the "changes" array
  const notifications = actionResp.notifications ?? [];
  const changes = notifications
    .map((n) => n.log_rendered)
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);

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

  const session = sessions.get(handle);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text:
            `Error: No session found with handle '${handle}'. ` +
            `Use bga_list_sessions to see active sessions.`,
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
          text: `Error: Session '${handle}' has stopped. Start a new session with bga_session_start.`,
        },
      ],
      isError: true,
    };
  }

  let resetResp: StateResponse;
  try {
    resetResp = (await bgaLiteFetch(session.baseUrl, "/reset", {
      method: "POST",
      body: "{}",
    })) as StateResponse;
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error resetting session '${handle}': ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  const playerMap = buildPlayerMap(session);

  // The /reset endpoint returns the initial state — format it the same way as bga_get_state
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
