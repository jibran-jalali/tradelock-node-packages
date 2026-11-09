import type { Metadata } from "next";
import TradeDashboard from "../trade-dashboard";
import { notFound } from "next/navigation";
import { deviceRole } from "../../lib/device-role";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Supplier | TradeLock" };
export default function SupplierPage() {
  if (deviceRole() !== "supplier") notFound();
  return <TradeDashboard key="supplier" role="supplier" />;
}
