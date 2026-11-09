import { readFileSync } from "node:fs";
import { join } from "node:path";
export function deviceRole(): "buyer" | "supplier" {
  let role = process.env.TRADELOCK_ROLE;
  if (!role) {
    try { role = JSON.parse(readFileSync(join(process.cwd(), "config/device.json"), "utf8")).role; }
    catch { role = "buyer"; }
  }
  if (role !== "buyer" && role !== "supplier") throw new Error("Invalid TradeLock device role.");
  return role;
}
