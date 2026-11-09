// One foreground owner for this package's node, website, and live terminal.
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { renderConsole } from './device-console.mjs';
import { readTailscaleStatus } from '../node/src/tailscale.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const index = process.argv.indexOf('--test-config');
const overrides = index >= 0 ? JSON.parse(readFileSync(resolve(process.argv[index + 1]), 'utf8')) : {};
const device = { ...JSON.parse(readFileSync('config/device.json', 'utf8')), ...overrides };
if (!['buyer', 'supplier'].includes(device.role)) throw new Error('Invalid device role.');
if (index >= 0 && !device.localTest) throw new Error('A test configuration must explicitly identify local verification.');
const runtime = join(root, '.runtime'); mkdirSync(runtime, { recursive: true });
const nodeConfig = { ...JSON.parse(readFileSync('node/config/node.json', 'utf8')), ...device.node,
  deviceRole: device.role, transport: device.localTest ? 'local-test' : 'tailscale',
  verification: !!device.localTest, keyFile: join(root, 'node/config/node.key') };
const panel = `http://127.0.0.1:${nodeConfig.controlPort}`;
const website = `http://127.0.0.1:${device.webPort}`;
const page = website + '/' + device.role;
const headless = process.argv.includes('--headless');
function openBrowser(url) {
  if (!headless) spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
}
async function portUsed(port) {
  return new Promise(resolvePort => { const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1500); socket.once('connect', () => { socket.destroy(); resolvePort(true); });
    socket.once('error', () => resolvePort(false)); socket.once('timeout', () => { socket.destroy(); resolvePort(true); }); });
}
const lock = join(runtime, 'device.lock');
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8')); let alive = false;
  try { process.kill(pid, 0); alive = true; } catch {}
  if (alive) {
    try { const response = await fetch(website + '/api/device'); const value = await response.json();
      if (value.role === device.role) {
        openBrowser(page);
        console.log('This device is already running. Reusing its website and node.');
        if (headless) process.exit(0);
        console.log('Live monitor attached. Ctrl+C closes this monitor; the original launcher owns the services.');
        const view = async () => {
          try { const state = await (await fetch(panel + '/api/status')).json();
            const lines = state.events.slice(0, 8).reverse().map(event => `[${new Date(event.time).toLocaleTimeString()}] ${event.message}`);
            process.stdout.write('\x1b[2J\x1b[H' + renderConsole(device, state, lines) + '\n');
          } catch { console.log('Original launcher stopped. Run START.bat again.'); process.exit(0); }
        };
        await view(); setInterval(() => void view(), 2000);
        await new Promise(() => {});
      }
    } catch {}
    throw new Error('This package is already starting. Use its existing terminal.');
  }
  unlinkSync(lock);
}
for (const port of [device.webPort, nodeConfig.controlPort, nodeConfig.rpcPort, nodeConfig.p2pPort]) {
  if (await portUsed(port)) throw new Error(`Port ${port} is occupied. Close the older TradeLock launcher first; it has been left untouched.`);
}
if (!existsSync('node_modules/next/dist/bin/next') || !existsSync('.next/BUILD_ID')) throw new Error('Package incomplete. Extract the entire ZIP, including node_modules and .next.');
writeFileSync(lock, String(process.pid), { flag: 'wx' });
writeFileSync(join(runtime, 'active-node.json'), JSON.stringify(nodeConfig));
const log = openSync(join(runtime, 'device.log'), 'a');
const errors = openSync(join(runtime, 'device-errors.log'), 'a');
const children = [], activity = [];
let shuttingDown = false, latest = null, interval = null, lastPrinted = '';
function addLine(text) { for (const line of text.split(/\r?\n/).filter(Boolean)) { activity.push(line.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 200)); activity.splice(50); } }
// Child output is captured below, not mixed into the full-screen panel.
function launch(entry, args, env = {}) {
  const child = spawn(process.execPath, [join(root, entry), ...args], { cwd: root, windowsHide: true,
    env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { addLine(data.toString()); writeFileSync(log, data); });
  child.stderr.on('data', data => { addLine(data.toString()); writeFileSync(errors, data); });
  child.on('error', error => { addLine(error.message); void shutdown(1); });
  child.on('exit', code => { if (!shuttingDown) { addLine(`Process stopped (${code}). Check .runtime/device-errors.log.`); void shutdown(1); } });
  children.push(child); return child;
}
async function shutdown(code = 0) {
  if (shuttingDown) return; shuttingDown = true; clearInterval(interval);
  try { const state = await (await fetch(panel + '/api/status', { signal: AbortSignal.timeout(1500) })).json();
    await fetch(panel + '/api/stop', { method: 'POST', headers: { 'X-Control-Token': state.controlToken }, signal: AbortSignal.timeout(8000) }); } catch {}
  for (const child of children) if (child.exitCode === null) child.kill();
  try { if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); } catch {}
  closeSync(log); closeSync(errors); console.log('\nThis TradeLock device stopped.'); process.exit(code);
}
process.on('SIGHUP', () => void shutdown()); process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
const node = launch('node/src/server.mjs', ['--headless', '--config', join(runtime, 'active-node.json'), '--data', join(root, 'node/data/node')]);
const web = launch('node_modules/next/dist/bin/next', ['start', '--hostname', '127.0.0.1', '--port', String(device.webPort)],
  { TRADELOCK_ROLE: device.role, TRADELOCK_LOCAL_GATEWAY: panel });
writeFileSync(join(runtime, 'processes.json'), JSON.stringify({ owner: process.pid, node: node.pid, web: web.pid }));
let refreshing = false, opened = false;
async function refresh() {
  if (refreshing || shuttingDown) return; refreshing = true;
  try {
    try { latest = await (await fetch(panel + '/api/status', { signal: AbortSignal.timeout(2000) })).json(); } catch {}
    if (!opened) try { if ((await fetch(website + '/api/device')).ok) { openBrowser(page); opened = true; } } catch {}
    const lines = latest?.events?.length ? latest.events.slice(0, 8).reverse().map(event => `[${new Date(event.time).toLocaleTimeString()}] ${event.message}`) : activity;
    const output = renderConsole(device, latest, lines);
    if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H' + output + '\n');
    else if (output !== lastPrinted) { console.log(output); lastPrinted = output; }
  } finally { refreshing = false; }
}
void refresh(); interval = setInterval(() => void refresh(), 2000);
if (!device.localTest && !headless) {
  const vpn = await readTailscaleStatus();
  if (!vpn.connected) {
    const executable = join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale/tailscale.exe');
    if (existsSync(executable)) {
      const login = spawn(executable, ['login'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(login);
      let authOpened = false;
      const authenticate = data => { const match = data.toString().match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (match && !authOpened) { authOpened = true; openBrowser(match[0]); addLine('Complete Tailscale sign-in in the browser; then join the same tailnet as the other device.'); } };
      login.stdout.on('data', authenticate); login.stderr.on('data', authenticate); login.on('error', () => addLine('Open Tailscale from the Windows tray and sign in.'));
    }
  }
}
