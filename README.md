# TradeLock

Two Windows packages for the same two-validator network.

| Download | Who uses it | Start |
| --- | --- | --- |
| [TradeLock-Host.zip](https://github.com/jibran-jalali/tradelock-node-packages/releases/download/v1.0.0/TradeLock-Host.zip) | Your laptop only | Extract everything, then run **START HOST.bat** |
| [TradeLock-Friend.zip](https://github.com/jibran-jalali/tradelock-node-packages/releases/download/v1.0.0/TradeLock-Friend.zip) | Send this ZIP to your friend | Extract everything, then run **RUN.bat** or **Start Friend Node.bat** |

Open [the release](https://github.com/jibran-jalali/tradelock-node-packages/releases/tag/v1.0.0) for both downloads and SHA-256 checksums. GitHub also generates source archives; those contain this README, not the runnable software. Download the two explicitly named packages above.

## Connect

1. Keep your existing host installation running, or use the extracted host package. Run only one copy of the host identity.
2. Both laptops currently need the same trusted private Wi-Fi/LAN. Different networks need additional VPN configuration, which is not included.
3. Your friend starts their extracted package and keeps its window open. Allow Java/Node on Private networks if Windows asks.
4. Each laptop opens its own control panel at **http://127.0.0.1:9050**. The host website is **http://localhost:3000**.
5. Both panels should show two nodes online, a connected peer, and advancing blocks after synchronization. The host can connect TradeLock to this chain once both validators are ready.

The friend profile initially points to **192.168.18.2**. If your host address changes, update it in the friend's panel and reconnect. Guest Wi-Fi may block device-to-device traffic. If connected peers wait after a long disconnection, stop and start both nodes from their panels.

## Included

The host ZIP includes the website source, installed dependencies, frontend build, Solidity artifacts, launcher, and bundled Node/npm, Java, and Besu. The friend ZIP includes its node and control panel with bundled runtimes; no separate Node or Java installation is needed. **SETUP.bat** in the friend package checks or restores missing runtimes.

These are clean runnable packages. Live databases, transaction history, logs, private environment files, and process IDs are excluded. The original laptop installation and history are preserved separately. The two ZIPs have different validator keys. **Keep the host ZIP to yourself and send only the friend ZIP.** Never use development keys for real funds.

## How it works

Two real Besu nodes maintain separate Ethereum-compatible databases and approve QBFT blocks. Both validators are required: this network has no spare-validator or Byzantine fault tolerance. It does not perform proof-of-work mining. The panels report actual RPC, peer, synchronization, and block data.

The website starts with Hardhat available and can switch to the separate two-node chain. Settle escrow before switching: balances and trade history do not migrate between ledgers. Blockchain validation is distributed across the two laptops; the website remains hosted on your laptop.

## Verified

- 41 contract tests and the production frontend build passed.
- A full escrow trade and payment completed on two real validator processes.
- Both nodes returned matching contract code, paid trade data, and a block with two QBFT commit seals.
- Stopping one validator stopped new blocks during the observation interval.
- A freshly extracted friend package synchronized the chain and read the paid trade.

These checks used two processes on one physical laptop. The friend's actual laptop, Wi-Fi, firewall, and browser opening still require verification.

The repository is private because the downloads contain the paired development validator identities. Your friend needs repository access to download directly from GitHub; alternatively, download the friend ZIP yourself and send that file.
