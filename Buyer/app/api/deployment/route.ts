import { resolveNetwork } from "../../../scripts/network-client.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  try {
    const node = await resolveNetwork();
    return Response.json({ ...node.deployment, networkReady: node.status.ready, networkStatus: node.status.consensus,
      networkId: node.networkId, onlineNodes: node.status.onlineNodes, settlementWorkerActive: node.settlementWorkerActive },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Start both blockchain nodes first." }, { status: 503 });
  }
}
