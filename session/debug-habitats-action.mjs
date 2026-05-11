import { handleGameplayTool } from "../dist/tools/gameplay.js";

const game = "habitats";
const port = 18260;
const handle = `${game}:${port}`;

await handleGameplayTool("bga_session_start", {
  game,
  players: 2,
  port,
  reset: true,
});

const stateResp = await handleGameplayTool("bga_get_state", {
  handle,
  format: "machine",
});
const state = JSON.parse(stateResp.content[0].text);

const actionName = Object.keys(state.legal_moves || {})[0];
const firstCandidate = state.legal_moves?.[actionName]?.candidates?.[0];

const actionResp = await handleGameplayTool("bga_perform_action", {
  handle,
  player_id: state.state?.active_player ?? state.state?.active_players?.[0] ?? 1000001,
  action: actionName,
  args: firstCandidate?.args || {},
  format: "machine",
});

console.log(JSON.stringify({ actionName, firstCandidate, response: JSON.parse(actionResp.content[0].text) }, null, 2));

await handleGameplayTool("bga_session_stop", { handle });
