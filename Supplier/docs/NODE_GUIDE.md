# One launcher on each device

Run Buyer/START.bat on your laptop and Supplier/START.bat on the other laptop. Each starts its validator, website and terminal. Both machines can use different internet connections.

First use: approve the signed Tailscale installation and the paired network's firewall rules if Windows asks. Sign in with your own account. Invite the Supplier to the Buyer tailnet through https://login.tailscale.com/admin/users . The Supplier accepts the invite and selects that network in Tailscale. Signing into two unrelated tailnets will not connect the nodes.

No public Tailscale auth keys are included. The node reads the local Tailscale service's online peer addresses and authenticates only its expected blockchain counterpart. It never treats another arbitrary Tailscale machine as a validator.

The browser opens the role in its folder. The terminal displays real VPN/node/peer/block activity. Wait for NETWORK READY. Either device disappearing pauses transactions; both must be online. Existing trade data stays readable from the local node. After reconnecting, consensus round recovery preserves the database.

Ctrl+C in the owning terminal stops its node and website. Re-running START.bat reuses an existing instance and displays a secondary monitor. Preserve node/data/node and node/config/node.key. Never duplicate a validator identity.

Both packages include Windows x64 Node, Java, Besu, npm, app dependencies and the production build. The only one-time user work is Windows installation approval when necessary and Tailscale login/invitation. No separate website startup is required.

Raw Ethereum RPC remains loopback-only. The paired gateway is authenticated. Inbound firewall exceptions are limited to the bundled Node/Java programs, required ports, and 100.64.0.0/10 VPN sources. The website itself is loopback-only.
