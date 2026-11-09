import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { readNetworkProfile } from "./scripts/network-profile.mjs";
import { DEMO_WALLETS } from "./lib/local-wallet.ts";

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    localhost: { type: "http", chainType: "l1", url: readNetworkProfile().rpcUrl, accounts: [DEMO_WALLETS.buyer.privateKey] },
  },
});
