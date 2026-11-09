# TradeLock

Two self-contained folders for two Windows x64 devices:

| Download | Device | Start |
| --- | --- | --- |
| [TradeLock-Buyer.zip](https://github.com/jibran-jalali/tradelock-node-packages/releases/download/v3.0.0/TradeLock-Buyer.zip) | Your laptop | Buyer/START.bat |
| [TradeLock-Supplier.zip](https://github.com/jibran-jalali/tradelock-node-packages/releases/download/v3.0.0/TradeLock-Supplier.zip) | Your friend's laptop | Supplier/START.bat |

Extract the entire ZIP. Each launcher starts a blockchain validator, its own role-specific website, and a live terminal showing actual VPN/node/peer/block activity. No separate website startup or role chooser is required.

## One-time network setup

Tailscale is bundled. Windows may ask for installation/firewall approval. Each person signs in using their own account. Buyer invites Supplier through https://login.tailscale.com/admin/users ; Supplier accepts and joins the same private network. No passwords or authentication keys need sharing.

After that, each person runs START.bat. Their browser opens the correct dashboard at http://127.0.0.1:3000. Wait for NETWORK READY and keep both terminals open. Repeated starts reuse an existing instance and attach a live monitor.

All TradeLock runtimes and dependencies are included. Tailscale connectivity needs internet. Blockchain execution, websites and document hashing stay local. The nodes find their expected counterpart using Tailscale's online peer addresses and pinned blockchain identity.

## Blockchain and trade rules

Two Besu validators use Ethereum-compatible QBFT Proof of Authority. Both must be online to commit blocks; the network has no spare-validator or Byzantine fault tolerance. The UI waits without quorum and never starts a replacement Hardhat chain or simulated balance.

Buyer funds the trade, Supplier marks it shipped, and Buyer confirms receipt to pay. A dispute within ten hours freezes automatic payment until agreement. The Buyer node submits eligible timeout payments independently of the browser. Shipment is a supplier claim. SHA-256 verifies unchanged file contents, not truthfulness.

Keep node/data/node on each laptop. Each package contains only its own validator private key. Do not run duplicate copies. Development wallet keys are public and must never hold real funds. Distribution ZIPs are clean starters; the original Buyer's blockchain history remains preserved on the laptop.

## Verification

52 tests, TypeScript/production build, role-specific routes, a real browser escrow payment through two packaged apps/nodes, matching ledgers and two commit seals, quorum-loss checks, restart/reconnection, repeated-start reuse, ZIP integrity, and fresh-extraction checks were verified locally. Buyer Tailscale installation/sign-in was verified. Two physical laptops on different networks still require the friend to run Supplier and join the same tailnet.

The repository is private because these packages contain the paired development validator identities. Download Supplier and forward that file, or grant repository access separately. Use v3; earlier releases remain backups of previous layouts.

## Repository source and runnable packages

The Buyer/ and Supplier/ folders in this repository contain reviewable source code. Installed dependencies, runtimes, private validator keys, pairing secrets and blockchain databases are excluded from Git. Redacted configuration examples are included. To RUN the applications, use the fully bundled release downloads above rather than GitHub's automatic source-code ZIP.

## Does the friend need the same Tailscale account?

No. Each person uses their own account. Buyer invites Supplier through https://login.tailscale.com/admin/users . Supplier accepts and selects the BUYER'S tailnet in Tailscale, rather than an unrelated personal tailnet. Do not share passwords or authentication keys.

On the other laptop: close old TradeLock launchers, transfer/extract the complete Supplier folder, run START.bat, approve Windows setup if requested, and sign in to the invited network. Run Buyer/START.bat on your laptop. Keep both terminals open and wait for NETWORK READY. Node identity, contract registration, peer connection and the role-specific website are handled automatically.
