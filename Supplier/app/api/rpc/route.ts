import { relayRpc } from "../../../scripts/network-client.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 262144) return Response.json({ error: "Request too large" }, { status: 413 });
    const result = await relayRpc(JSON.parse(text));
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Blockchain network unavailable" }, { status: 503 });
  }
}
