import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const execute = promisify(execFile);
export function tailscaleAddress(ip) {
  return typeof ip === 'string' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(\d{1,3})\.(\d{1,3})$/.test(ip)
    && ip.split('.').every(part => Number(part) <= 255);
}
export function parseTailscaleStatus(value) {
  const ownIp = (value.Self?.TailscaleIPs || value.TailscaleIPs || []).find(tailscaleAddress);
  const connected = value.BackendState === 'Running' && !!ownIp && value.Self?.Online !== false;
  const peers = Object.values(value.Peer || {}).filter(peer => peer.Online)
    .flatMap(peer => (peer.TailscaleIPs || []).filter(tailscaleAddress)).filter(ip => ip !== ownIp);
  return { connected, ownIp: ownIp || null, peers: [...new Set(peers)].slice(0, 32),
    status: connected ? 'CONNECTED' : value.BackendState === 'NeedsLogin' ? 'SIGN IN TO TAILSCALE' : 'TAILSCALE DISCONNECTED' };
}
export async function readTailscaleStatus() {
  const executable = join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
  if (!existsSync(executable)) return { connected: false, ownIp: null, peers: [], status: 'TAILSCALE NOT INSTALLED' };
  try {
    const { stdout } = await execute(executable, ['status', '--json'], { windowsHide: true, timeout: 5000 });
    return parseTailscaleStatus(JSON.parse(stdout));
  } catch { return { connected: false, ownIp: null, peers: [], status: 'OPEN TAILSCALE AND SIGN IN' }; }
}
export function pairedAnnouncement(value, config, descriptor) {
  const expected = config.role === 'host' ? config.friendPublicKey : config.hostPublicKey;
  return value.protocolVersion === 2 && value.networkId === config.networkId
    && value.genesisHash === descriptor.genesisHash && value.publicKey === expected.toLowerCase()
    && Number.isInteger(value.p2pPort) && value.p2pPort >= 1024 && value.p2pPort <= 65535;
}
export async function findPairedPeer(vpn, config, descriptor) {
  const results = await Promise.allSettled(vpn.peers.map(async ip => {
    const endpoint = `http://${ip}:${config.controlPort}`;
    const response = await fetch(endpoint + '/network/status', { redirect: 'error',
      headers: { 'X-TradeLock-Network': config.networkToken }, signal: AbortSignal.timeout(1800) });
    if (!response.ok) throw new Error('Peer not available');
    const value = await response.json();
    if (!pairedAnnouncement(value, config, descriptor)) throw new Error('Unpaired node');
    return { endpoint, ip, p2pPort: value.p2pPort };
  }));
  return results.find(result => result.status === 'fulfilled')?.value || null;
}
