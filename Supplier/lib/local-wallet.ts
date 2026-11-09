import { JsonRpcProvider, Wallet, type Provider } from "ethers";

export const LOCAL_RPC_URL = "http://127.0.0.1:8545";
export type DemoWalletId = "buyer" | "supplier";

// Intentionally PUBLIC Hardhat development keys. Never use these accounts for real funds.
// This local demo is not a secure wallet or an account authentication system.
export const DEMO_WALLETS = {
  buyer: {
    label: "Buyer wallet",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    privateKey:
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  supplier: {
    label: "Supplier wallet",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    privateKey:
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
} as const;

export function isDemoWalletId(value: unknown): value is DemoWalletId {
  return value === "buyer" || value === "supplier";
}

export function createLocalProvider(rpcUrl?: string) {
  // Fixed loopback endpoint, with real network detection rather than a pinned network result.
  const endpoint = rpcUrl ?? (typeof window === "undefined" ? LOCAL_RPC_URL : `${window.location.origin}/api/rpc`);
  return new JsonRpcProvider(endpoint, undefined, {
    cacheTimeout: -1,
    pollingInterval: 1000,
  });
}

export async function createLocalSigner(id: DemoWalletId, provider: Provider) {
  if (!isDemoWalletId(id))
    throw new Error("Choose a built-in development wallet.");
  if ((await provider.getNetwork()).chainId !== 31337n) {
    throw new Error("Built-in wallets only sign on local chain 31337.");
  }
  // Ethers signs in this browser; the RPC receives a signed raw transaction, not this key.
  return new Wallet(DEMO_WALLETS[id].privateKey, provider);
}
