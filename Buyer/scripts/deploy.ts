import { network } from "hardhat";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const { ethers } = await network.create();
try {
  const previousText = await readFile("lib/deployment.json", "utf8");
  await mkdir(".runtime/deployments", { recursive: true });
  const backup = `.runtime/deployments/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(backup, previousText);
  console.log(`Previous deployment preserved in ${backup}`);
  const previous = JSON.parse(previousText);
  if ((await ethers.provider.getCode(previous.address)) !== "0x") {
    const old = new ethers.Contract(
      previous.address,
      previous.abi,
      ethers.provider,
    );
    if ((await old.totalLocked()) > 0n)
      throw new Error(
        "Existing trades still hold escrow. Settle those trades before switching the active contract; no funds have been migrated.",
      );
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const contract = await ethers.deployContract("TradeLock");
await contract.waitForDeployment();
const receipt = await contract.deploymentTransaction()!.wait();
const chain = await ethers.provider.getNetwork();
const deployment = {
  schemaVersion: 2,
  receiptWindowSeconds: 36000,
  address: await contract.getAddress(),
  chainId: Number(chain.chainId),
  blockNumber: receipt!.blockNumber,
  blockHash: receipt!.blockHash,
  transactionHash: receipt!.hash,
  abi: JSON.parse(contract.interface.formatJson()),
};
await mkdir("lib", { recursive: true });
await writeFile(
  "lib/deployment.json",
  JSON.stringify(deployment, null, 2) + "\n",
);
console.log(
  `TradeLock deployed at ${deployment.address}; frontend configuration written automatically.`,
);
