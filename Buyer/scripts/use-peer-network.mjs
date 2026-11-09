// Switch only after preserving each ledger's deployment; never hide unsettled escrow.
import { readFile, writeFile, mkdir, copyFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Contract, JsonRpcProvider } from "ethers";
import { readNetworkProfile } from "./network-profile.mjs";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const mode = process.argv[2];
if (!["hardhat", "peer"].includes(mode)) throw new Error("Choose hardhat or peer.");
const previous = readNetworkProfile();
const target = { mode, rpcUrl: mode === "peer" ? "http://127.0.0.1:9545" : "http://127.0.0.1:8545" };
const profilePath = join(root, ".runtime/network.json");
const deploymentPath = join(root, "lib/deployment.json");
const oldText = await readFile(deploymentPath, "utf8");
const old = JSON.parse(oldText);
const provider = new JsonRpcProvider(previous.rpcUrl, undefined, { cacheTimeout: -1 });
try {
  if (previous.mode !== mode && await new Contract(old.address, old.abi, provider).totalLocked() !== 0n) throw new Error("Current trades still hold escrow. Settle them before changing networks.");
} finally { provider.destroy(); }
await mkdir(".runtime/networks", { recursive: true });
await writeFile(`.runtime/networks/${previous.mode}-deployment.json`, oldText);
await writeFile(profilePath, JSON.stringify(target));
try {
  let saved = null;
  try { saved = JSON.parse(await readFile(`.runtime/networks/${mode}-deployment.json`, "utf8")); } catch {}
  let valid = false;
  const p = new JsonRpcProvider(target.rpcUrl, undefined, { cacheTimeout: -1 });
  try {
    if (saved) { const block = await p.getBlock(saved.blockNumber); valid = block?.hash === saved.blockHash && await p.getCode(saved.address) !== "0x"; }
    if ((await p.getNetwork()).chainId !== 31337n) throw new Error("Incorrect chain ID.");
  } finally { p.destroy(); }
  if (valid) await writeFile(deploymentPath, JSON.stringify(saved, null, 2));
  else {
    // A different ledger's deployment is already archived; deploy.ts must inspect this ledger only.
    await unlink(deploymentPath);
    const result = spawnSync(process.execPath, ["node_modules/hardhat/dist/src/cli.js", "run", "scripts/deploy.ts", "--network", "localhost"], { cwd: root, stdio: "inherit", windowsHide: true });
    if (result.status !== 0) throw new Error("Contract deployment failed; restoring previous network.");
  }
  await copyFile(deploymentPath, `.runtime/networks/${mode}-deployment.json`);
  console.log(`TradeLock now uses ${mode}. Existing ledgers were preserved.`);
} catch (error) {
  await writeFile(profilePath, JSON.stringify(previous));
  await writeFile(deploymentPath, oldText);
  throw error;
}
