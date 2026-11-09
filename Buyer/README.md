# TradeLock: Buyer and Supplier

Two folders, two devices, one shared Ethereum-compatible chain.

1. On your laptop, open **Buyer/START.bat**.
2. Send the entire **Supplier** folder (or its ZIP) to your friend. They extract it and run **START.bat**.
3. First use installs the bundled, signed Tailscale client if missing and adds two narrow inbound rules for its private VPN addresses. Each person signs in with their own account. Buyer invites Supplier through https://login.tailscale.com/admin/users and Supplier joins the SAME tailnet.
4. Each browser opens its own role-specific dashboard at http://127.0.0.1:3000. Keep both live terminal windows open. Wait for **NETWORK READY**, then trade.

Node.js, Java, Besu, npm, website dependencies, and the production website build are included. There are no application dependency downloads on first run. Tailscale authentication/connectivity requires internet. No password, seed phrase, or Tailscale authentication key is embedded in either package.

The actual Buyer node and Supplier node discover their pinned counterpart among online Tailscale peers. They check network identity and genesis, then connect using private VPN addresses. No Wi-Fi address editing, router forwarding, central website, manual contract deployment, or Hardhat fallback is needed.

## What runs locally

Each device runs a Besu QBFT validator, its own persistent chain database, and its own Next.js website. The browser signs real transactions with its assigned development wallet. The Buyer interface creates orders and confirms or disputes receipt; Supplier handles shipment and its side of resolutions. Other-role routes are unavailable in each package. Permissions are still enforced by the Solidity contract and wallet addresses.

The actual terminal reports VPN connectivity, validator count, peer count, block height, contract address, and recent node/transaction activity. Repeated START.bat reuses existing services and opens a live monitor. Closing a secondary monitor leaves the original launcher running. Ctrl+C in the owning terminal stops that device's services.

## Payment and documents

Funded -> Shipped -> Paid. Shipment is a supplier claim. The buyer has ten hours after shipment to confirm or dispute. A timely dispute freezes payment until both parties agree to pay the supplier or refund the buyer. Without a dispute, the Buyer node's worker submits an eligible release transaction after the deadline. The contract enforces these rules.

Invoice SHA-256 hashing occurs in the browser. Only the fingerprint is on-chain; invoice files are not uploaded. A matching hash establishes unchanged contents, not the truthfulness of the invoice.

## Keep and protect

Keep each device's `node/data/node/` between runs. It is not a disposable cache. Buyer retains the existing chain history. Each folder contains only its own validator private key. Never run copies of one identity on multiple devices.

This is a two-validator Proof of Authority network using QBFT. Both must be online to commit blocks. It has no spare-validator or Byzantine fault tolerance. The websites remain available while disconnected, but transactions wait for quorum. Tailscale is an external connection service; blockchain execution and website hosting remain on the laptops. Public development wallets and test currency must never be used for real funds.

## Source and tests

`app/`: dashboards and API. `contracts/`: Solidity escrow. `lib/`: wallet, hashing and role helpers. `node/src/`: validator/gateway and Tailscale peer discovery. `scripts/start-device.mjs`: the single launcher and terminal. `config/device.json`: fixed device role. `node/config/`: paired chain and this device's identity. `node/runtime/` and `node_modules/`: bundled dependencies. `docs/`: escrow rules and presentation notes.

The workspace source is retained for review. Use the Buyer and Supplier folders for normal operation, not the superseded separate-node/web launchers.
