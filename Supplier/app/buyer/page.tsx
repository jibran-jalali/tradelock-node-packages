import type { Metadata } from "next";
import TradeDashboard from "../trade-dashboard";
import { notFound } from "next/navigation";
import { deviceRole } from "../../lib/device-role";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Buyer | TradeLock" };
export default function BuyerPage() {
  if (deviceRole() !== "buyer") notFound();
  return <TradeDashboard key="buyer" role="buyer" />;
}
