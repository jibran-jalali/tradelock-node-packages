import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
export function readNetworkProfile() {
  let profile;
  try { profile = JSON.parse(readFileSync(join(root, ".runtime/network.json"), "utf8")); } catch { profile = { mode: "hardhat", rpcUrl: "http://127.0.0.1:8545" }; }
  if (!["hardhat", "peer"].includes(profile.mode) || !/^http:\/\/127\.0\.0\.1:(8545|9545)$/.test(profile.rpcUrl)) throw new Error("Invalid local network profile.");
  return profile;
}
