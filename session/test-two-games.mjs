import { handleGameplayTool } from "../dist/tools/gameplay.js";

const games = ["seaside", "habitats"];
const basePort = 18220;

function pickActionAndArgs(state) {
  const legalMoves = state?.legal_moves || {};
  const action =
    Object.keys(legalMoves).find(
      (k) =>
        Array.isArray(legalMoves[k]?.candidates) &&
        legalMoves[k].candidates.length > 0
    ) ||
    Object.keys(legalMoves)[0] ||
    state?.available_actions?.[0];

  if (!action) {
    return { action: undefined, args: {} };
  }

  const firstCandidate = legalMoves[action]?.candidates?.[0];
  return {
    action,
    args: firstCandidate?.args || {},
  };
}

async function testGame(game, idx) {
  const port = basePort + idx;
  const handle = `${game}:${port}`;
  const out = { game, handle, steps: [], action_committed: false, verdict: "fail" };

  try {
    const start = await handleGameplayTool("bga_session_start", {
      game,
      players: 2,
      port,
      reset: true,
    });
    out.steps.push({
      step: "start",
      ok: !start.isError,
      text: start.content?.[0]?.text?.slice(0, 180),
    });
    if (start.isError) return out;

    const stateResp = await handleGameplayTool("bga_get_state", {
      handle,
      format: "machine",
    });
    if (stateResp.isError) {
      out.steps.push({
        step: "get_state",
        ok: false,
        text: stateResp.content?.[0]?.text?.slice(0, 180),
      });
      return out;
    }

    const state = JSON.parse(stateResp.content[0].text);
    out.steps.push({
      step: "get_state",
      ok: state.success === true,
      state: state.state?.name,
      actions: state.available_actions?.length ?? 0,
      legalMoveActions: Object.keys(state.legal_moves || {}).length,
    });

    const suggest = await handleGameplayTool("bga_suggest_actions", {
      handle,
      objective: "maximize score",
    });
    out.steps.push({
      step: "suggest",
      ok: !suggest.isError,
      text: suggest.content?.[0]?.text?.split("\n")[0] ?? "",
    });

    const snapSave = await handleGameplayTool("bga_save_snapshot", {
      handle,
      name: `smoke_${game}`,
    });
    out.steps.push({
      step: "save_snapshot",
      ok: !snapSave.isError,
      text: snapSave.content?.[0]?.text?.slice(0, 180),
    });

    const firstPick = pickActionAndArgs(state);
    if (firstPick.action) {
      const activePlayerId =
        state.state?.active_player ?? state.state?.active_players?.[0] ?? 1000001;
      const actionResp = await handleGameplayTool("bga_perform_action", {
        handle,
        player_id: activePlayerId,
        action: firstPick.action,
        args: firstPick.args,
        format: "machine",
      });
      let actionPayload = JSON.parse(actionResp.content[0].text);

      if (!actionPayload.success && actionPayload.legal_moves) {
        const retryState = {
          legal_moves: actionPayload.legal_moves,
          available_actions: actionPayload.available_actions || [],
        };
        const retryPick = pickActionAndArgs(retryState);
        if (retryPick.action) {
          const retryResp = await handleGameplayTool("bga_perform_action", {
            handle,
            player_id: activePlayerId,
            action: retryPick.action,
            args: retryPick.args,
            format: "machine",
          });
          const retryPayload = JSON.parse(retryResp.content[0].text);
          out.steps.push({
            step: "perform_action_retry",
            ok: !!retryPayload.success,
            action: retryPick.action,
            error_code: retryPayload.error_code || null,
          });
          if (retryPayload.success) {
            actionPayload = retryPayload;
          }
        }
      }

      out.action_committed = !!actionPayload.success;
      out.steps.push({
        step: "perform_action",
        ok: out.action_committed,
        action: firstPick.action,
        error_code: actionPayload.error_code || null,
      });
    } else {
      out.steps.push({
        step: "perform_action",
        ok: false,
        text: "No action discovered from legal moves/available actions",
      });
    }

    const allNonActionStepsOk = out.steps
      .filter((s) => s.step !== "perform_action" && s.step !== "perform_action_retry")
      .every((s) => s.ok === true);
    out.verdict = out.action_committed && allNonActionStepsOk ? "pass" : "fail";

    const list = await handleGameplayTool("bga_list_snapshots", { handle });
    out.steps.push({
      step: "list_snapshots",
      ok: !list.isError,
      text: list.content?.[0]?.text?.slice(0, 180),
    });

    const reset = await handleGameplayTool("bga_reset_session", {
      handle,
      format: "machine",
    });
    const resetPayload = JSON.parse(reset.content[0].text);
    out.steps.push({
      step: "reset",
      ok: resetPayload.success === true,
      state: resetPayload.state?.name,
    });

    const stop = await handleGameplayTool("bga_session_stop", { handle });
    out.steps.push({
      step: "stop",
      ok: !stop.isError,
      text: stop.content?.[0]?.text?.slice(0, 180),
    });

    const allNonActionStepsOkAfterStop = out.steps
      .filter((s) => s.step !== "perform_action" && s.step !== "perform_action_retry")
      .every((s) => s.ok === true);
    out.verdict = out.action_committed && allNonActionStepsOkAfterStop ? "pass" : "fail";

    return out;
  } catch (e) {
    out.steps.push({ step: "exception", ok: false, text: String(e) });
    try {
      await handleGameplayTool("bga_session_stop", { handle });
    } catch {
      // ignore cleanup errors
    }
    return out;
  }
}

const results = [];
for (let i = 0; i < games.length; i++) {
  results.push(await testGame(games[i], i));
}

console.log(JSON.stringify({ results }, null, 2));
