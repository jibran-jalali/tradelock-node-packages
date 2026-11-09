import { deviceRole } from "../../../lib/device-role";
export const dynamic = "force-dynamic";
export function GET() { return Response.json({ role: deviceRole() }); }
