import { redirect } from "next/navigation";
import { deviceRole } from "../lib/device-role";
export const dynamic = "force-dynamic";
export default function Home() { redirect(`/${deviceRole()}`); }
