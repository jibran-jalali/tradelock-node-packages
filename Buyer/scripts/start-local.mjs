// Start or reuse the local services. Never reset the chain or terminate another app.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { readNetworkProfile } from "./network-profile.mjs";
const networkProfile = readNetworkProfile();

const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const runtime = join(root, ".runtime");
mkdirSync(runtime, { recursive: true });
const npmCli =
  process.env.npm_execpath ??
  join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");

function npm(...args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`npm ${args.join(" ")} failed. See the output above.`);
}

async function rpc(method, params = []) {
  const response = await fetch(networkProfile.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(2000),
  });
  const body = await response.json();
  if (!response.ok || body.error)
    throw new Error(body.error?.message ?? "Local RPC request failed.");
  return body.result;
}

function portInUse(port, host) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function launch(name, entry, args) {
  const output = openSync(join(runtime, `${name}.log`), "a");
  const errors = openSync(join(runtime, `${name}-error.log`), "a");
  const child = spawn(process.execPath, [join(root, entry), ...args], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", output, errors],
  });
  child.on("error", (error) => console.error(`${name}: ${error.message}`));
  closeSync(output);
  closeSync(errors);
  if (!child.pid)
    throw new Error(`Could not start ${name}. Check .runtime logs.`);
  writeFileSync(join(runtime, `${name}.pid`), String(child.pid));
  child.unref();
  console.log(`Started ${name} (PID ${child.pid}).`);
}

async function waitUntil(check, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (await check()) return;
    } catch {
      /* Allow the service time to start. */
    }
    await delay(500);
  }
  throw new Error(`${label} did not become ready. Check .runtime logs.`);
}

async function websiteReady() {
  const response = await fetch("http://localhost:3000", {
    signal: AbortSignal.timeout(2000),
  });
  return (
    response.ok &&
    (await response.text()).includes("TradeLock | Trade with confidence")
  );
}

try {
  if (!existsSync(join(root, "node_modules/.package-lock.json"))) npm("ci");

  if (networkProfile.mode === "hardhat" && !(await portInUse(8545, "127.0.0.1"))) {
    launch("chain", "node_modules/hardhat/dist/src/cli.js", [
      "node",
      "--hostname",
      "127.0.0.1",
    ]);
    await waitUntil(
      async () => (await rpc("eth_chainId")) === "0x7a69",
      "Hardhat",
    );
  }
  const chainId = await rpc("eth_chainId");
  const client = await rpc("web3_clientVersion");
  if (chainId !== "0x7a69" || !(networkProfile.mode === "peer" ? /besu/i : /hardhat/i).test(client)) {
    throw new Error(
      "Port 8545 belongs to another blockchain. Stop that service yourself before starting TradeLock.",
    );
  }
  console.log(`${networkProfile.mode === "peer" ? "Two-node Besu network" : "Local Hardhat node"} ready (chain 31337).`);

  let deploymentValid = false;
  try {
    const saved = JSON.parse(
      readFileSync(join(root, "lib/deployment.json"), "utf8"),
    );
    const block = await rpc("eth_getBlockByNumber", [
      "0x" + saved.blockNumber.toString(16),
      false,
    ]);
    const code = await rpc("eth_getCode", [saved.address, "latest"]);
    deploymentValid =
      saved.schemaVersion === 2 &&
      saved.chainId === 31337 &&
      block?.hash === saved.blockHash &&
      code !== "0x";
    if (deploymentValid)
      console.log(
        `Reusing contract ${saved.address}; existing trades preserved.`,
      );
  } catch {
    /* A missing or reset deployment is deployed below. */
  }
  if (!deploymentValid) npm("run", "deploy");

  const webPortUsed = await portInUse(3000, "localhost");
  if (webPortUsed) {
    if (!(await websiteReady()))
      throw new Error(
        "Port 3000 belongs to another app. Stop that app yourself before starting TradeLock.",
      );
    console.log("Reusing the running TradeLock website.");
  } else {
    if (!existsSync(join(root, ".next/BUILD_ID"))) npm("run", "build");
    launch("web", "node_modules/next/dist/bin/next", [
      "start",
      "--hostname",
      "localhost",
    ]);
    await waitUntil(websiteReady, "TradeLock website");
  }

  const response = await fetch("http://localhost:3000/api/deployment", {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok)
    throw new Error("The website cannot read the deployment configuration.");
  const activeDeployment = await response.json();
  let workerAlive = false;
  try {
    const workerPid = Number(
      readFileSync(join(runtime, "settlement.pid"), "utf8"),
    );
    process.kill(workerPid, 0);
    workerAlive = true;
  } catch {}
  if (!workerAlive) launch("settlement", "scripts/settlement-worker.mjs", []);
  await waitUntil(async () => {
    const status = JSON.parse(
      readFileSync(join(runtime, "settlement-status.json"), "utf8"),
    );
    return (
      status.running &&
      status.contractAddress === activeDeployment.address &&
      Date.now() - status.updatedAt < 30000
    );
  }, "Automatic settlement worker");
  console.log(
    "Automatic settlement worker ready; overdue undisputed trades release without a browser.",
  );
  console.log("\nReady: http://localhost:3000");
  console.log(
    "Built-in Buyer and Supplier wallets ready. No browser extension needed.",
  );
  console.log(
    "Network: TradeLock Local | RPC http://127.0.0.1:8545 | Chain 31337 | ETH",
  );
  console.log(
    "Only test ETH. Closing this launcher keeps services running; restarting the chain clears its data.",
  );
} catch (error) {
  console.error(`\nSetup stopped: ${error.message}`);
  process.exitCode = 1;
}
