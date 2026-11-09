import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TradeDashboard from "../../trade-dashboard";
import { deviceRole } from "../../../lib/device-role";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Trade resolution | TradeLock" };
export default async function DisputePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const role = deviceRole();
  return (
    <TradeDashboard key={`${role}-${id}`} role={role} disputeId={Number(id)} />
  );
}
