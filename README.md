# TradeLock

The website and the blockchain are now separate.

| Package | Use |
| --- | --- |
| [TradeLock-Host.zip](https://github.com/jibran-jalali/tradelock-node-packages/releases/download/v2.0.0/TradeLock-Host.zip) | Your node and paired website, with separate launchers |
| [TradeLock-Friend.zip](https://github.com/jibran-jalali/tradelock-node-packages/releases/download/v2.0.0/TradeLock-Friend.zip) | Node B only; send this to your friend |

1. Run **Start Node.cmd** on your laptop.
2. Your friend extracts the new v2 friend ZIP and runs **RUN.bat**.
3. Wait for **NETWORK READY** on both 90s-style terminal panels.
4. Start the separate website with **Start TradeLock.cmd**. It automatically discovers the running shared network.

Node panels: http://127.0.0.1:9050 on each laptop. Website: http://localhost:3000 wherever its server runs.

The website can run on another reachable computer using its paired files and Node.js 24. It does not start Hardhat, a validator, or another deployment. One available node can serve reads; new transactions require both validators. If no nodes are reachable, the website waits and reconnects.

The host node owns automatic contract registration and the ten-hour deadline worker. Website shutdown does not stop the blockchain. A timely dispute freezes payment on-chain until both parties agree on payment or refund. A file hash detects altered contents, not truthfulness.

## First use

The compact packages download and verify missing Node.js, Java, and Besu runtimes locally. This needs internet once. Reuse an existing v1 runtime folder to avoid downloads. The host website installs pinned npm dependencies if needed. No system Java installation, paid API, real currency, or Docker is required.

Both laptops need the same trusted LAN or a separately configured private VPN. Discovery does not cross arbitrary internet networks. Allow Node/Java on Private networks if Windows asks. The initial host address is 192.168.18.2; the friend panel can update it. For routed private networks, the website supports TRADELOCK_NODE_URLS.

## Consensus and checks

Two real Besu validators use QBFT Proof of Authority. Both must stay online; the two-validator network has no spare-validator or Byzantine fault tolerance. Actual peers, blocks, synchronization, and transactions drive the panel.

Verified locally: 47 tests, TypeScript/production build, a full browser escrow payment on the shared chain, two commit seals, matching ledgers, automatic discovery, read failover, and no-node waiting without switching to Hardhat. The physical friend laptop and its network still require verification.

Only one copy of each validator identity may run. Keep the host package to yourself and send only the friend ZIP. This repository is private: download the friend file and forward it, or give your friend repository access separately. Never use development keys for real funds.

The previous v1 release remains a backup. Use v2 for the new gateway/discovery protocol and terminal UI. The original laptop data was preserved.
