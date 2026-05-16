import { afterEach, describe, expect, it } from "vitest";
import {
  handleLiteRuntimeTool,
  liteRuntimeTools,
  resetRuntimeFactoryForTests,
  setRuntimeFactoryForTests,
} from "../../src/tools/lite-runtime.js";

function makeFakeRuntime() {
  const fakeSession = {
    id: "sess-1",
    getSummary: () => ({ id: "sess-1", mode: "scenario", game: "seaside" }),
    getState: async () => ({
      stateId: 3,
      name: "chooseAction",
      activePlayers: [1000001],
      possibleActions: ["actTakeTile"],
    }),
    getGameDatas: async () => ({ score: { 1000001: 0 } }),
    getPlayers: async () => [{ id: 1000001, name: "Ada", color: "ff0000", number: 1 }],
    performAction: async () => ({
      success: true,
      action: { name: "actTakeTile", playerId: 1000001, args: { tileId: 7 } },
      notifications: [{ logRendered: "Ada takes tile 7" }],
      stateAfter: { stateId: 4, name: "next" },
    }),
    resetSession: async () => ({
      stateId: 1,
      name: "setup",
      activePlayers: [1000001],
      possibleActions: ["actStart"],
    }),
    getEventTimeline: () => [{ kind: "action", at: "2026-01-01T00:00:00.000Z", payload: {} }],
    getWarnings: () => [{ code: "NONDETERMINISM_RISK", message: "sample" }],
  };

  return {
    createSession: async () => fakeSession,
    loadSession: async ({ id }: { id: string }) => {
      if (id !== "sess-1") {
        throw new Error("Session not found");
      }
      return fakeSession;
    },
    listSessions: () => [{ id: "sess-1", mode: "scenario", game: "seaside" }],
    closeSession: async () => undefined,
  };
}

afterEach(() => {
  resetRuntimeFactoryForTests();
});

describe("bga-lite runtime tools", () => {
  it("registers phase 2 runtime tools", () => {
    const names = new Set(liteRuntimeTools.map((t) => t.name));

    expect(names.has("bga_runtime_create_session")).toBe(true);
    expect(names.has("bga_session_perform_action")).toBe(true);
    expect(names.has("bga_session_timeline")).toBe(true);
    expect(names.has("bga_session_warnings")).toBe(true);
    expect(names.has("bga_session_close")).toBe(true);
  });

  it("creates and lists sessions", async () => {
    setRuntimeFactoryForTests(async () => makeFakeRuntime());

    const createResp = await handleLiteRuntimeTool("bga_runtime_create_session", {
      mode: "scenario",
      game: "seaside",
      format: "machine",
    });

    expect(createResp.isError).toBeFalsy();
    expect(createResp.content[0].text).toContain("\"success\": true");

    const listResp = await handleLiteRuntimeTool("bga_runtime_list_sessions", {
      format: "machine",
    });

    expect(listResp.isError).toBeFalsy();
    expect(listResp.content[0].text).toContain("sess-1");
  });

  it("gets state and performs action", async () => {
    setRuntimeFactoryForTests(async () => makeFakeRuntime());

    const stateResp = await handleLiteRuntimeTool("bga_session_get_state", {
      id: "sess-1",
      format: "summary",
    });

    expect(stateResp.isError).toBeFalsy();
    expect(stateResp.content[0].text).toContain("State: chooseAction");

    const actionResp = await handleLiteRuntimeTool("bga_session_perform_action", {
      id: "sess-1",
      playerId: 1000001,
      name: "actTakeTile",
      args: { tileId: 7 },
      format: "summary",
    });

    expect(actionResp.isError).toBeFalsy();
    expect(actionResp.content[0].text).toContain("Action actTakeTile succeeded");
    expect(actionResp.content[0].text).toContain("Ada takes tile 7");
  });

  it("returns machine errors on runtime failure", async () => {
    setRuntimeFactoryForTests(async () => makeFakeRuntime());

    const resp = await handleLiteRuntimeTool("bga_session_get_state", {
      id: "missing",
      format: "machine",
    });

    expect(resp.isError).toBe(true);
    expect(resp.content[0].text).toContain("\"success\": false");
    expect(resp.content[0].text).toContain("Session not found");
  });
});
