import http from "node:http";
import { handleGameplayTool } from "../dist/tools/gameplay.js";

function rawGet(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          ok: true,
          status: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8").slice(0, 500),
        });
      });
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: String(err), message: err?.message || null });
    });
    req.setTimeout(10000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

for (const [game, port] of [
  ["seaside", 18240],
  ["castlecombo", 18241],
]) {
  const handle = `${game}:${port}`;
  console.log("\n===", game, "===");
  const start = await handleGameplayTool("bga_session_start", {
    game,
    players: 2,
    port,
    reset: true,
  });
  console.log("start isError:", start.isError);
  console.log(start.content?.[0]?.text?.split("\n").slice(0, 3).join("\n"));

  const raw = await rawGet(`http://localhost:${port}/state`);
  console.log("raw /state:", raw);

  const viaTool = await handleGameplayTool("bga_get_state", {
    handle,
    format: "machine",
  });
  console.log("tool isError:", viaTool.isError);
  console.log("tool text:", viaTool.content?.[0]?.text?.slice(0, 300));

  const stop = await handleGameplayTool("bga_session_stop", { handle });
  console.log("stop isError:", stop.isError);
}
