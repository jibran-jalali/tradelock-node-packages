"use client";
import { useEffect, useState } from "react";
type NetworkState = { connected: boolean; ready: boolean; onlineNodes: number; block?: number; status: string };
export default function NetworkStatus() {
  const [state, setState] = useState<NetworkState | null>(null);
  useEffect(() => {
    let active = true;
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const response = await fetch("/api/network", { cache: "no-store" });
        const value = await response.json();
        if (active) setState(value);
      } catch {
        if (active) setState({ connected: false, ready: false, onlineNodes: 0, status: "Website connection unavailable." });
      } finally { running = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <section className={`shared-network ${state?.ready ? "ready" : "waiting"}`} aria-label="Blockchain network" role="status">
    <strong>{!state ? "Finding your blockchain network…" : state.ready ? `Network ready · ${state.onlineNodes}/2 nodes · Block #${state.block}` : state.connected ? `Waiting for both nodes · ${state.onlineNodes}/2 reachable` : "No blockchain node reachable"}</strong>
    <span>{state?.ready ? "Both devices are synchronized on the shared TradeLock chain." : "Run START.bat in Buyer and Supplier, sign in to the same Tailscale network, and keep both terminals open. Connection retries automatically."}</span>
  </section>;
}
