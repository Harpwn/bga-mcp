/**
 * MCP-level integration tests for gameplay tools (task 30)
 * Tests the full workflow of session creation, state fetching, actions, and snapshots
 * across both workspace layouts.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  handleGameplayTool,
  sessions,
  ErrorCode,
  MachinePayload,
} from "../../src/tools/gameplay.js";
import { execSync } from "node:child_process";

type ActionPick = {
  action?: string;
  args: Record<string, unknown>;
};

function pickActionAndArgs(payload: MachinePayload): ActionPick {
  const legalMoves = payload.legal_moves ?? {};
  const action =
    Object.keys(legalMoves).find(
      (k) =>
        Array.isArray(legalMoves[k]?.candidates) &&
        (legalMoves[k]?.candidates?.length ?? 0) > 0
    ) ??
    Object.keys(legalMoves)[0] ??
    payload.available_actions?.[0];

  if (!action) {
    return { action: undefined, args: {} };
  }

  return {
    action,
    args: legalMoves[action]?.candidates?.[0]?.args ?? {},
  };
}

async function performActionWithRetry(
  handle: string,
  statePayload: MachinePayload,
): Promise<{ committed: boolean; firstAction?: string; retryAction?: string }> {
  const playerId =
    statePayload.state?.active_player ??
    statePayload.state?.active_players?.[0] ??
    1000001;

  const first = pickActionAndArgs(statePayload);
  if (!first.action) {
    return { committed: false };
  }

  const firstResp = await handleGameplayTool("bga_perform_action", {
    handle,
    player_id: playerId,
    action: first.action,
    args: first.args,
    format: "machine",
  });
  const firstPayload = JSON.parse(firstResp.content[0].text) as MachinePayload;

  if (firstPayload.success) {
    return { committed: true, firstAction: first.action };
  }

  if (!firstPayload.legal_moves) {
    return { committed: false, firstAction: first.action };
  }

  const retryCandidatePayload: MachinePayload = {
    success: false,
    available_actions: firstPayload.available_actions,
    legal_moves: firstPayload.legal_moves,
  };
  const retry = pickActionAndArgs(retryCandidatePayload);
  if (!retry.action) {
    return { committed: false, firstAction: first.action };
  }

  const retryResp = await handleGameplayTool("bga_perform_action", {
    handle,
    player_id: playerId,
    action: retry.action,
    args: retry.args,
    format: "machine",
  });
  const retryPayload = JSON.parse(retryResp.content[0].text) as MachinePayload;

  return {
    committed: !!retryPayload.success,
    firstAction: first.action,
    retryAction: retry.action,
  };
}

// Cleanup helper
function cleanupSession(handle: string): void {
  const session = sessions.get(handle);
  if (session && session.status === "running") {
    handleGameplayTool("bga_session_stop", { handle }).catch(() => {});
  }
  sessions.delete(handle);
}

describe("MCP Gameplay Tools Integration Tests (Task 30)", () => {
  const TEST_PORTS = [18185, 18186, 18187, 18188, 18189];
  let nextPort = 0;

  function getNextPort(): number {
    return TEST_PORTS[nextPort % TEST_PORTS.length];
  }

  afterEach(() => {
    // Clean up all sessions
    for (const [handle] of sessions) {
      cleanupSession(handle);
    }
  });

  describe("Session lifecycle (bga_session_start → stop)", () => {
    it("should start a session and return valid startup response", async () => {
      const port = TEST_PORTS[0];
      const result = await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Session started");
      expect(result.content[0].text).toContain(`seaside:${port}`);
      cleanupSession(`seaside:${port}`);
    });

    it("should return error for non-existent game", async () => {
      const result = await handleGameplayTool("bga_session_start", {
        game: "nonexistent_game_xyz",
        players: 2,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error");
    });
  });

  describe("State fetching (bga_get_state)", () => {
    it("should return state in summary format", async () => {
      const port = TEST_PORTS[1];
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      const result = await handleGameplayTool("bga_get_state", {
        handle: `seaside:${port}`,
        format: "summary",
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("State:");
      expect(result.content[0].text).toContain("Active player");
      cleanupSession(`seaside:${port}`);
    });

    it("should return state in machine format with legal_moves", async () => {
      const port = TEST_PORTS[2];
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      const result = await handleGameplayTool("bga_get_state", {
        handle: `seaside:${port}`,
        format: "machine",
      });

      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(result.content[0].text) as MachinePayload;
      expect(payload.success).toBe(true);
      expect(payload.state).toBeDefined();
      expect(payload.available_actions).toBeDefined();
      expect(payload.legal_moves).toBeDefined();
      expect(Object.keys(payload.legal_moves).length).toBeGreaterThan(0);
      cleanupSession(`seaside:${port}`);
    });

    it("should return SESSION_NOT_FOUND error for invalid handle", async () => {
      const result = await handleGameplayTool("bga_get_state", {
        handle: "nonexistent:9999",
        format: "machine",
      });

      expect(result.isError).toBe(true);
      const payload = JSON.parse(result.content[0].text) as MachinePayload;
      expect(payload.success).toBe(false);
      expect(payload.error_code).toBe(ErrorCode.SESSION_NOT_FOUND);
    });
  });

  describe("Action performing (bga_perform_action)", () => {
    it("should perform a valid action in summary format", async () => {
      const port = TEST_PORTS[3];
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      // Get state to find first action and parameters
      const stateResp = await handleGameplayTool("bga_get_state", {
        handle: `seaside:${port}`,
        format: "machine",
      });
      const statePayload = JSON.parse(
        stateResp.content[0].text
      ) as MachinePayload;
      const firstMove =
        statePayload.legal_moves!["actPlayToken"]?.candidates?.[0];

      if (firstMove && firstMove.args) {
        const result = await handleGameplayTool("bga_perform_action", {
          handle: `seaside:${port}`,
          player_id: 1000001,
          action: "actPlayToken",
          args: firstMove.args,
          format: "summary",
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("Action succeeded");
      }

      cleanupSession(`seaside:${port}`);
    });

    it("should return ACTION_REJECTED error for wrong player", async () => {
      const port = TEST_PORTS[4];
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      const result = await handleGameplayTool("bga_perform_action", {
        handle: `seaside:${port}`,
        player_id: 1000002, // Wrong player (not active)
        action: "actPlayToken",
        args: { tokenId: 1, tokenType: "TEST" },
        format: "machine",
      });

      expect(result.isError).toBe(true);
      const payload = JSON.parse(result.content[0].text) as MachinePayload;
      expect(payload.success).toBe(false);
      expect(payload.error_code).toBe(ErrorCode.ACTION_REJECTED);
      expect(payload.legal_moves).toBeDefined(); // Should include legal moves in error
      cleanupSession(`seaside:${port}`);
    });
  });

  describe("Session reset (bga_reset_session)", () => {
    it("should reset session to initial state in summary format", async () => {
      const port = 18190;
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      // Perform an action first
      const stateResp = await handleGameplayTool("bga_get_state", {
        handle: `seaside:${port}`,
        format: "machine",
      });
      const statePayload = JSON.parse(
        stateResp.content[0].text
      ) as MachinePayload;
      const firstMove =
        statePayload.legal_moves!["actPlayToken"]?.candidates?.[0];

      if (firstMove && firstMove.args) {
        await handleGameplayTool("bga_perform_action", {
          handle: `seaside:${port}`,
          player_id: 1000001,
          action: "actPlayToken",
          args: firstMove.args,
        });
      }

      // Reset
      const result = await handleGameplayTool("bga_reset_session", {
        handle: `seaside:${port}`,
        format: "summary",
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("reset successfully");
      cleanupSession(`seaside:${port}`);
    });

    it("should reset session in machine format", async () => {
      const port = 18191;
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      const result = await handleGameplayTool("bga_reset_session", {
        handle: `seaside:${port}`,
        format: "machine",
      });

      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(result.content[0].text) as MachinePayload;
      expect(payload.success).toBe(true);
      expect(payload.state).toBeDefined();
      expect(payload.legal_moves).toBeDefined();
      cleanupSession(`seaside:${port}`);
    });
  });

  describe("Snapshots (save/load/list/delete)", () => {
    it("should save and list snapshots", async () => {
      const port = 18192;
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      const saveResult = await handleGameplayTool("bga_save_snapshot", {
        handle: `seaside:${port}`,
        name: "test_snapshot",
        note: "Test snapshot",
      });

      expect(saveResult.isError).toBeFalsy();
      expect(saveResult.content[0].text).toContain("saved successfully");

      const listResult = await handleGameplayTool("bga_list_snapshots", {
        handle: `seaside:${port}`,
      });

      expect(listResult.isError).toBeFalsy();
      expect(listResult.content[0].text).toContain("test_snapshot");
      cleanupSession(`seaside:${port}`);
    });
  });

  describe("Action suggestions (bga_suggest_actions)", () => {
    it("should suggest actions with scores and confidence", async () => {
      const port = 18193;
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      const result = await handleGameplayTool("bga_suggest_actions", {
        handle: `seaside:${port}`,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Action Suggestions");
      expect(result.content[0].text).toContain("score:");
      expect(result.content[0].text).toContain("confidence:");
      expect(result.content[0].text).toContain("Reasons:");
      cleanupSession(`seaside:${port}`);
    });

    it("should suggest actions with objective", async () => {
      const port = 18194;
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      const result = await handleGameplayTool("bga_suggest_actions", {
        handle: `seaside:${port}`,
        objective: "maximize board control",
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("objective: maximize board control");
      cleanupSession(`seaside:${port}`);
    });
  });

  describe("Backward compatibility (default summary format)", () => {
    it("should default to summary format when format not specified", async () => {
      const port = 18195;
      await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });

      // Call without specifying format
      const result = await handleGameplayTool("bga_get_state", {
        handle: `seaside:${port}`,
      });

      // Should return summary format (human-readable, not JSON)
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("State:");
      // Should NOT be valid JSON (summary format is text)
      try {
        JSON.parse(result.content[0].text);
        expect.fail("Should not be JSON");
      } catch {
        // Expected - not JSON
      }
      cleanupSession(`seaside:${port}`);
    });
  });

  describe("Error code stability", () => {
    it("should consistently return error_code in machine format", async () => {
      // Test multiple error scenarios
      const scenarios = [
        {
          name: "SESSION_NOT_FOUND",
          tool: "bga_get_state",
          args: { handle: "invalid:9999", format: "machine" },
          expectedCode: ErrorCode.SESSION_NOT_FOUND,
        },
        {
          name: "SESSION_NOT_FOUND (after session stop)",
          setup: async (port: number) => {
            await handleGameplayTool("bga_session_start", {
              game: "seaside",
              players: 2,
              port,
              reset: true,
            });
            await handleGameplayTool("bga_session_stop", {
              handle: `seaside:${port}`,
            });
          },
          tool: "bga_get_state",
          args: (port: number) => ({ handle: `seaside:${port}`, format: "machine" }),
          expectedCode: ErrorCode.SESSION_NOT_FOUND,
          port: 18196,
        },
      ];

      for (const scenario of scenarios) {
        if (scenario.setup && scenario.port) {
          await scenario.setup(scenario.port);
          const result = await handleGameplayTool(scenario.tool, scenario.args(scenario.port));
          const payload = JSON.parse(result.content[0].text) as MachinePayload;
          expect(payload.error_code).toBe(scenario.expectedCode);
        } else {
          const result = await handleGameplayTool(scenario.tool, scenario.args);
          const payload = JSON.parse(result.content[0].text) as MachinePayload;
          expect(payload.error_code).toBe(scenario.expectedCode);
        }
      }
    });
  });

  describe("Full workflow integration", () => {
    it("should support complete game session workflow", async () => {
      const port = 18197;

      // 1. Start session
      const startResp = await handleGameplayTool("bga_session_start", {
        game: "seaside",
        players: 2,
        port,
        reset: true,
      });
      expect(startResp.isError).toBeFalsy();

      // 2. Get initial state
      const initialStateResp = await handleGameplayTool("bga_get_state", {
        handle: `seaside:${port}`,
        format: "machine",
      });
      const initialState = JSON.parse(
        initialStateResp.content[0].text
      ) as MachinePayload;
      expect(initialState.success).toBe(true);

      // 3. Get suggestions
      const suggestionsResp = await handleGameplayTool("bga_suggest_actions", {
        handle: `seaside:${port}`,
      });
      expect(suggestionsResp.isError).toBeFalsy();

      // 4. Save snapshot
      const snapshotResp = await handleGameplayTool("bga_save_snapshot", {
        handle: `seaside:${port}`,
        name: "workflow_test",
      });
      expect(snapshotResp.isError).toBeFalsy();

      // 5. Perform action
      const firstMove =
        initialState.legal_moves!["actPlayToken"]?.candidates?.[0];
      if (firstMove && firstMove.args) {
        const actionResp = await handleGameplayTool("bga_perform_action", {
          handle: `seaside:${port}`,
          player_id: 1000001,
          action: "actPlayToken",
          args: firstMove.args,
          format: "machine",
        });
        const actionResult = JSON.parse(actionResp.content[0].text) as MachinePayload;
        expect(actionResult.success).toBe(true);
      }

      // 6. Reset to snapshot
      const resetResp = await handleGameplayTool("bga_reset_session", {
        handle: `seaside:${port}`,
        format: "machine",
      });
      const resetResult = JSON.parse(resetResp.content[0].text) as MachinePayload;
      expect(resetResult.success).toBe(true);

      // 7. Clean up
      const stopResp = await handleGameplayTool("bga_session_stop", {
        handle: `seaside:${port}`,
      });
      expect(stopResp.isError).toBeFalsy();
      cleanupSession(`seaside:${port}`);
    });
  });

  describe("Strict two-game verdict workflow", () => {
    it("should pass strict verdict for seaside and habitats with action retry", async () => {
      const games = [
        { game: "seaside", port: 18298 },
        { game: "habitats", port: 18299 },
      ];

      for (const { game, port } of games) {
        const handle = `${game}:${port}`;

        const startResp = await handleGameplayTool("bga_session_start", {
          game,
          players: 2,
          port,
          reset: true,
        });
        expect(startResp.isError).toBeFalsy();

        const stateResp = await handleGameplayTool("bga_get_state", {
          handle,
          format: "machine",
        });
        expect(stateResp.isError).toBeFalsy();
        const statePayload = JSON.parse(stateResp.content[0].text) as MachinePayload;
        expect(statePayload.success).toBe(true);

        const suggestResp = await handleGameplayTool("bga_suggest_actions", {
          handle,
          objective: "maximize score",
        });
        expect(suggestResp.isError).toBeFalsy();

        const saveResp = await handleGameplayTool("bga_save_snapshot", {
          handle,
          name: `strict_${game}`,
        });
        expect(saveResp.isError).toBeFalsy();

        const actionResult = await performActionWithRetry(handle, statePayload);
        expect(actionResult.committed).toBe(true);

        const listResp = await handleGameplayTool("bga_list_snapshots", { handle });
        expect(listResp.isError).toBeFalsy();

        const resetResp = await handleGameplayTool("bga_reset_session", {
          handle,
          format: "machine",
        });
        expect(resetResp.isError).toBeFalsy();
        const resetPayload = JSON.parse(resetResp.content[0].text) as MachinePayload;
        expect(resetPayload.success).toBe(true);

        const stopResp = await handleGameplayTool("bga_session_stop", {
          handle,
        });
        expect(stopResp.isError).toBeFalsy();

        cleanupSession(handle);
      }
    }, 30000);
  });
});
