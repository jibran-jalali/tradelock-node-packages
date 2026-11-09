// A local transaction sender, not an administrator. Solidity decides what may be paid.
import { Contract } from "ethers";
import { readNetworkProfile } from "./network-profile.mjs";
import { readFile, writeFile, mkdir, unlink, open } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalProvider, createLocalSigner } from "../lib/local-wallet.ts";
import {
  canReleaseAfterDeadline,
  readChainTimestamp,
} from "../lib/trade-rules.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runtime = join(root, ".runtime");

// Exported so tests exercise the actual worker against an isolated Hardhat chain.
export async function releaseOverdueTrades(contract, timestamp) {
  const released = [],
    failed = [];
  const count = Number(await contract.tradeCount());
  for (let id = 1; id <= count; id++) {
    const trade = await contract.getTrade(id);
    if (
      !canReleaseAfterDeadline(
        Number(trade.status),
        Number(trade.releaseDeadline),
        timestamp,
      )
    )
      continue;
    try {
      const receipt = await (await contract.claimPayment(id)).wait();
      if (!receipt || receipt.status !== 1)
        throw new Error("Payment transaction failed");
      released.push({ id, hash: receipt.hash });
      console.log(`Released overdue trade ${id}: ${receipt.hash}`);
    } catch (error) {
      // A competing payment/dispute or rejected receiver cannot stop the other trades.
      failed.push({
        id,
        message: error.reason ?? error.shortMessage ?? error.message,
      });
      console.error(`Trade ${id}: ${failed.at(-1).message}`);
    }
  }
  return { released, failed };
}

async function runOnce() {
  let contractAddress = "";
  const provider = createLocalProvider(readNetworkProfile().rpcUrl);
  try {
    const deployment = JSON.parse(
      await readFile(join(root, "lib/deployment.json"), "utf8"),
    );
    if (deployment.schemaVersion !== 2 || deployment.chainId !== 31337)
      throw new Error("Deploy the updated contract first.");
    const block = await provider.getBlock(deployment.blockNumber);
    if (
      !block ||
      block.hash !== deployment.blockHash ||
      (await provider.getCode(deployment.address)) === "0x"
    )
      throw new Error("Deployment is stale; run npm.cmd run deploy.");
    contractAddress = deployment.address;
    const signer = await createLocalSigner("supplier", provider);
    const contract = new Contract(deployment.address, deployment.abi, signer);
    // Hardhat's pending block clock advances even when no transactions are mined.
    const timestamp = await readChainTimestamp(provider);
    await writeStatus({ contractAddress, running: true });
    const result = await releaseOverdueTrades(contract, timestamp);
    await writeStatus({
      contractAddress,
      running: true,
      lastFailures: result.failed,
    });
    return result;
  } catch (error) {
    await writeStatus({
      contractAddress,
      running: false,
      error: error.message,
    });
    throw error;
  } finally {
    provider.destroy();
  }
}

async function writeStatus(value) {
  await mkdir(runtime, { recursive: true });
  await writeFile(
    join(runtime, "settlement-status.json"),
    JSON.stringify({ ...value, pid: process.pid, updatedAt: Date.now() }),
  );
}

async function main() {
  await mkdir(runtime, { recursive: true });
  if (process.argv.includes("--once")) {
    await runOnce();
    await writeStatus({ contractAddress: "", running: false });
    return;
  }
  const lockPath = join(runtime, "settlement.lock");
  try {
    const oldPid = Number(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(oldPid) || oldPid <= 0)
      throw new Error(
        "Invalid settlement lock; inspect .runtime/settlement.lock.",
      );
    let alive = false;
    try {
      process.kill(oldPid, 0);
      alive = true;
    } catch {}
    if (alive)
      throw new Error(`Settlement worker already running (PID ${oldPid}).`);
    await unlink(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const lock = await open(lockPath, "wx");
  await lock.writeFile(String(process.pid));
  await lock.close();
  await writeFile(join(runtime, "settlement.pid"), String(process.pid));
  let stopped = false;
  process.on("SIGINT", () => {
    stopped = true;
  });
  process.on("SIGTERM", () => {
    stopped = true;
  });
  console.log("Automatic settlement worker started. Checks every 10 seconds.");
  try {
    while (!stopped) {
      try {
        await runOnce();
      } catch (error) {
        console.error(error.message);
      }
      if (!stopped) await delay(10000);
    }
  } finally {
    const owner = await readFile(lockPath, "utf8").catch(() => "");
    if (owner === String(process.pid)) await unlink(lockPath);
    await writeStatus({ contractAddress: "", running: false });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
