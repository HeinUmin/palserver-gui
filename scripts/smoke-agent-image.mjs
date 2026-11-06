// Run inside the production Agent image (see the docker-agent CI job).
// No Docker socket, real game installation, or external network is needed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = process.env.PALSERVER_REPO_DIR;
assert.ok(root, "PALSERVER_REPO_DIR must point to packaged build contexts");
assert.ok(process.env.PALSERVER_DATA_DIR, "Use an isolated PALSERVER_DATA_DIR for this check");
for (const flavor of ["vanilla", "vanilla-arm64", "wine"]) {
  for (const file of ["Dockerfile", "entrypoint.sh"]) {
    assert.ok(fs.statSync(path.join(root, "images", flavor, file)).isFile());
  }
}
for (const file of ["LICENSE.md", "THIRD_PARTY_LICENSES.md"]) {
  assert.ok(fs.statSync(path.join(root, file)).isFile());
}
const bot = await import(path.join(root, "packages/discord-bot/dist/bot.js"));
assert.equal(typeof bot.startBot, "function");

const port = "18250";
let output = "";
const child = spawn(process.execPath, ["packages/agent/dist/index.js"], {
  cwd: root,
  env: { ...process.env, PALSERVER_AGENT_HOST: "127.0.0.1", PALSERVER_AGENT_PORT: port,
    PALSERVER_REQUIRE_TOKEN: "0", PALSERVER_TLS: "0", PALSERVER_NO_OPEN: "1",
    PALSERVER_TELEMETRY: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
const exited = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/license`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const status = await response.json();
        assert.ok(Array.isArray(status.features));
        ready = true;
        break;
      }
    } catch { /* Agent is still starting. */ }
    await delay(500);
  }
  assert.ok(ready, `Agent did not start successfully:\n${output}`);
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const asset = html.match(/src="([^"]+\.js)"/);
  assert.ok(asset, "Bundled web UI must reference its JavaScript asset");
  assert.equal((await fetch(new URL(asset[1], response.url))).status, 200);
  console.log("Agent image: game contexts, notices, bot dependencies, API and bundled web UI passed.");
} finally {
  child.kill("SIGKILL");
  await exited;
}
