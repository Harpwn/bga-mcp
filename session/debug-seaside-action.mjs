import { handleGameplayTool } from "../dist/tools/gameplay.js";

const game = "seaside";
const port = 18250;
const handle = `${game}:${port}`;

const start = await handleGameplayTool("bga_session_start", {
  game,
  players: 2,
  port,
  reset: true,
});
console.log("START:", start.content?.[0]?.text?.split("\n").slice(0, 3).join("\n"));

const stateResp = await handleGameplayTool("bga_get_state", {
  handle,
  format: "machine",
});
console.log("STATE isError:", stateResp.isError);
const state = JSON.parse(stateResp.content[0].text);
console.log("STATE summary:", {
  success: state.success,
  state: state.state?.name,
  active_player: state.state?.active_player,
  actions: state.available_actions,
  legalKeys: Object.keys(state.legal_moves || {}),
});

const move = state.legal_moves?.actPlayToken?.candidates?.[0];
console.log("FIRST CANDIDATE:", move);

const actionResp = await handleGameplayTool("bga_perform_action", {
  handle,
  player_id: state.state?.active_player,
  action: "actPlayToken",
  args: move?.args || {},
  format: "machine",
});
console.log("ACTION isError:", actionResp.isError);
console.log("ACTION payload:", actionResp.content?.[0]?.text);

const stop = await handleGameplayTool("bga_session_stop", { handle });
console.log("STOP:", stop.content?.[0]?.text);
