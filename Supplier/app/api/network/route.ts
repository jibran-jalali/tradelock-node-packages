import { resolveNetwork } from "../../../scripts/network-client.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  try {
    const node = await resolveNetwork();
    return Response.json({ connected: true, ready: node.status.ready, status: node.status.consensus,
      onlineNodes: node.status.onlineNodes, block: node.status.block, networkId: node.networkId,
      contract: node.deployment.address, settlementWorkerActive: node.settlementWorkerActive });
  } catch (error) {
    return Response.json({ connected: false, ready: false, onlineNodes: 0,
      status: error instanceof Error ? error.message : "Start both nodes." });
  }
}
