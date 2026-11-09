export function renderConsole(device, state, lines = []) {
  const role = device.role.toUpperCase();
  const network = state?.transport?.status || 'STARTING NODE';
  const block = state?.local?.online ? `#${state.local.block}` : '--';
  return [
    '+------------------------------------------------------------------+',
    `| TRADELOCK ${role.padEnd(8)} | ETHEREUM QBFT NODE / LIVE TERMINAL    |`,
    '+------------------------------------------------------------------+',
    `  Website     http://localhost:${device.webPort}/${device.role}`,
    `  Transport   ${network}`,
    `  VPN address ${state?.transport?.address || '--'}`,
    `  Blockchain  ${state?.consensus || 'BOOTING'}`,
    `  Validators  ${state ? state.onlineNodes : '--'} / 2 online`,
    `  Peers       ${state ? state.connectedPeers : '--'}`,
    `  Block       ${block}`,
    `  Contract    ${state?.deployment?.address || 'Waiting for registration'}`,
    ...(device.localTest ? ['  TEST MODE   TWO PROCESSES ON ONE LAPTOP, NOT TWO PHYSICAL DEVICES'] : []),
    ...(state?.error ? [`  Attention   ${state.error}`] : []),
    '', '  LIVE ACTIVITY',
    ...lines.slice(-8).map(line => '  ' + line),
    '', '  Keep this window open. Ctrl+C stops this device cleanly.',
    '  Both devices must be online to confirm transactions.',
  ].join('\n');
}
