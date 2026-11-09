// Reuse this host's control panel or start its bundled validator software.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeRoot = join(root, "node");
const config = JSON.parse(readFileSync(join(nodeRoot, "config/node.json"), "utf8"));
const panel = "http://127.0.0.1:9050";
async function status() {
  const response = await fetch(panel + "/api/status", { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error("Node panel unavailable.");
  const state = await response.json();
  if (state.role !== "host" || state.local.publicKey !== config.hostPublicKey.toLowerCase()) {
    throw new Error("Port 9050 belongs to a different node. It has been left running.");
  }
  return state;
}
try {
  await status();
  console.log(`Host node panel already running: ${panel}`);
} catch (error) {
  if (error.message.includes("different node")) throw error;
  const data = join(nodeRoot, "data");
  mkdirSync(data, { recursive: true });
  const output = openSync(join(data, "host-control.log"), "a");
  const errors = openSync(join(data, "host-control-error.log"), "a");
  const child = spawn(join(nodeRoot, "runtime/node.exe"), [join(nodeRoot, "src/server.mjs"), "--headless"], {
    cwd: nodeRoot, detached: true, windowsHide: true, stdio: ["ignore", output, errors],
  });
  closeSync(output); closeSync(errors);
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.unref();
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(500);
    try { await status(); ready = true; break; } catch {}
  }
  if (!ready) throw new Error("Host panel did not start. Check node/data/host-control-error.log.");
  console.log(`Host node panel ready: ${panel}`);
}
console.log("Node only. Start the separate website after both panels show NETWORK READY.");
