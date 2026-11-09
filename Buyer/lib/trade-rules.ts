// Display/worker helpers only. Solidity repeats and enforces these rules on-chain.
export const RECEIPT_WINDOW_SECONDS = 10 * 60 * 60;
export const TRADE_STATUSES = [
  "Funded",
  "Shipped",
  "Paid",
  "Disputed",
  "Refunded",
];
export const RESOLUTIONS = { None: 0, PaySupplier: 1, RefundBuyer: 2 } as const;

export async function readChainTimestamp(provider: {
  send(method: string, params: unknown[]): Promise<unknown>;
}): Promise<number> {
  // Pending Hardhat blocks have a null block number. Read raw timestamp without
  // Ethers' full mined-block formatter, which rejects that valid pending shape.
  const block = (await provider.send("eth_getBlockByNumber", [
    "pending",
    false,
  ])) as { timestamp?: unknown } | null;
  if (
    !block ||
    typeof block.timestamp !== "string" ||
    !/^0x[0-9a-f]+$/i.test(block.timestamp)
  )
    throw new Error("Blockchain clock unavailable.");
  const timestamp = Number(BigInt(block.timestamp));
  if (!Number.isSafeInteger(timestamp))
    throw new Error("Invalid blockchain timestamp.");
  return timestamp;
}
export function isEscrowLocked(status: number): boolean {
  return status === 0 || status === 1 || status === 3;
}
export function canReleaseAfterDeadline(
  status: number,
  deadline: number,
  now: number,
): boolean {
  return status === 1 && deadline > 0 && now >= deadline;
}
export function canDispute(
  status: number,
  deadline: number,
  now: number,
): boolean {
  return status === 1 && deadline > 0 && now < deadline;
}
export function remainingTime(deadline: number, now: number): string {
  const seconds = Math.max(0, Math.ceil(deadline - now));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
