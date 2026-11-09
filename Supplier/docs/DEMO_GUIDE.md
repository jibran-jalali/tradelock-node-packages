# TradeLock demo guide

First run Node A and Node B separately and wait for NETWORK READY. Then launch the website with Start TradeLock.cmd. The website discovers the shared chain automatically; it never starts Hardhat or a validator. Read [the exact node and website steps](NODE_GUIDE.md).

The host node runs the ten-hour settlement worker even when the website is closed. The buyer can confirm receipt or dispute within that window; disputes freeze payment until both parties agree on an outcome.

## 1. Built-in local wallets

TradeLock has three pages: `/` is a simple Buyer/Supplier chooser, `/buyer` is the buyer dashboard, and `/supplier` is the supplier dashboard. Each dashboard loads its corresponding development wallet automatically. Click the address in the top bar to read its full address and real test-ETH balance or disconnect/reconnect that wallet. Use **Choose a different role** to return home. Both routes can be opened directly or in separate tabs; they do not share a mutable wallet session. Keys are intentionally public constants in `lib/local-wallet.ts`.

The application configures this connection automatically:

| Setting         | Value                   |
| --------------- | ----------------------- |
| Network name    | TradeLock QBFT         |
| RPC URL         | `/api/rpc` via discovered node gateway |
| Chain ID        | `31337`                 |
| Currency symbol | `ETH`                   |
| Block explorer  | Leave empty             |

The browser sends signed transactions to the website server, which discovers the paired node gateway. The signer refuses any chain ID other than 31337. Local ETH has no monetary value. These wallets are a simplified native development system, not secure personal accounts or a production wallet.

### The two development accounts

Both are already included; no import is needed. These are Hardhat's default **public development keys**, used by Ethers to sign inside the browser. They must **never hold real funds on any network**. Anyone can select and use either identity in this demo; there is no password, authentication server, or encrypted vault. Do not enter your own private key or recovery phrase.

**Buyer — Hardhat account #0**

```text
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**Supplier — Hardhat account #1**

```text
Address: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Private key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

The node starts each account with 10,000 test ETH; deployment, transactions, and demonstrations spend some of it. Balances are read from the blockchain, never simulated. Each transaction opens TradeLock's review dialog showing the selected signer, contract, network, wallet payment, and action. Network gas costs additional test ETH. **Sign & submit** produces a real signed Ethereum transaction; **Cancel transaction** does not sign or send anything.

Scope change: the original MetaMask requirement was replaced at the user's request with this built-in wallet. Signing uses the existing [Ethers Wallet API](https://docs.ethers.org/v6/api/wallet/); we do not invent cryptography. The later 10-hour/dispute update adds contract rules described in [ESCROW_RULES.md](ESCROW_RULES.md).

## 2. Demonstrate a complete trade

1. Keep the blockchain and website terminals running using README commands. Open `http://localhost:3000`.
2. Choose **Enter as Buyer**, which opens `/buyer`. The Buyer development wallet is selected automatically. Check Hardhat / 31337 and the address. Open the wallet panel to see the complete address and current balance.
3. Click **New trade**. Supplier: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`. Description: Cotton shirts. Quantity: 20. Payment: 1 test ETH.
4. Select `public/invoices/invoice-original.txt`. TradeLock hashes its exact bytes locally. Click **Create & fund trade**, inspect the in-app wallet review, and click **Sign & submit**. Wait for the on-chain success message.
5. The trade is **Funded**. Open its details. Select the original invoice: **Matches registered document**. Select `invoice-altered.txt`: **Does not match.** Its quantity is 200 instead of 20.
6. Use **Choose a different role → Enter as Supplier**, or open `/supplier` in another tab. The Supplier development wallet is selected automatically and its assigned order appears. The contract always enforces the actual signing address.
7. Click **Mark shipped** and then **Sign & submit** in the wallet review. Status becomes **Shipped**. Explain that this is a supplier claim, not proof of delivery. Open details to verify either invoice from this role too.
8. Return to `/buyer` using the home chooser or your Buyer tab. Click **Confirm receipt**, read the payment warning, then **Release 1.0 ETH** (amount formatting may vary). Review and click **Sign & submit**.
9. Status becomes **Paid**. Escrow held drops by 1 ETH; payment released increases by 1 ETH. The supplier receives exactly 1 ETH from this transaction. The buyer also pays gas; the supplier earlier paid gas to mark shipped, so comparing its balance from before shipment requires accounting for that gas.
10. Open details to show creation, shipment, and payment transaction hashes. There is no public block explorer for this private chain; hashes identify the real transactions in the node logs and RPC. The Paid trade has no further payment button.

Optional: click **Cancel transaction** in a wallet review to show cancellation. Show that only buyers have **New trade** and receipt-confirmation actions, while suppliers have **Mark shipped**. Each page uses its own wallet address and filters actual blockchain records. For direct unauthorized contract calls, point to the automated permission tests. A route is not authentication: anyone can open either public demo wallet, and Solidity still checks the transaction's actual signing address.

## 3. Understand the code

### Contract functions

| Function or getter                                           | Plain-English explanation                                                                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTrade(supplier, description, quantity, documentHash)` | Payable: takes test ETH and creates a Funded trade in one transaction. Checks positive funding and quantity, valid parties, 1–280 description bytes, and a nonzero hash. IDs start at 1. |
| `getTrade(id)`                                               | Reads all stored fields. Unknown IDs revert. Anyone with node access can read this; it is not confidential.                                                                              |
| `markShipped(id)`                                            | Only the supplier can change Funded to Shipped. Records the shipment timestamp and starts the 10-hour receipt/dispute window.                                                            |
| `confirmReceipt(id)`                                         | Only the buyer can change Shipped to Paid and send exactly this trade's amount to its supplier. A failed transfer reverts status and accounting.                                         |
| `claimPayment(id)`                                           | After the deadline, anyone may trigger payment for an undisputed Shipped trade. Funds always go to the stored supplier.                                                                  |
| `raiseDispute(id, reason)`                                   | Buyer only, before the deadline. Stores the reason, changes Shipped to Disputed, and blocks timeout payment.                                                                             |
| `proposeResolution(id, outcome)`                             | Either party proposes supplier payment or buyer refund for a Disputed trade; Funded trades can only propose a refund. No funds move yet.                                                 |
| `acceptResolution(id, outcome, proposer)`                    | The other party approves the exact current proposal, then the contract pays or refunds. Stale approvals and self-approval revert.                                                        |
| `cancelResolution(id)`                                       | The current proposer withdraws an unaccepted proposal. Funds remain locked.                                                                                                              |
| `tradeCount()`                                               | Number of trades created. Used to read trade records.                                                                                                                                    |
| `totalLocked()`                                              | Sum of unpaid escrow obligations. Reduced exactly once per successful payment. Unexpected ETH forced into the contract would be surplus, not a new trade obligation.                     |
| `nonReentrant` modifier                                      | Blocks a receiver's callback from entering a second state-changing function during payment. The contract also updates state before sending ETH.                                          |

`TradeCreated`, `TradeShipped`, and `TradePaid` events provide the lifecycle activity and transaction hashes. `amount` remains the original payment amount after settlement; `status` distinguishes paid history from locked funds. The test receiver contract only exercises failure and callback behavior.

### How the parts communicate

The Next.js page selects a built-in public test wallet. For reads, Ethers calls the local node at port 8545. For writes, the in-app wallet dialog asks for approval. Ethers signs the contract transaction in the browser and sends the signed raw transaction to Hardhat; it does not send the private key to the RPC. Hardhat executes Solidity and mines a local block. The page waits for the receipt and then rereads trades, balances, and events. It also refreshes every eight seconds and after wallet changes. The signer refuses other chains, and writes are disabled when deployment is missing/stale.

The only Next.js API reads the local deployment address/ABI file and settlement-worker heartbeat. It does not sign transactions or store invoices. `lib/hash.ts` calls the browser's SHA-256 implementation before a trade is funded and when a document is verified. Separately, `scripts/settlement-worker.mjs` checks every 10 seconds and sends overdue undisputed payment transactions, even with the browser closed. The contract enforces the rules; the worker is not an admin.

### On-chain and off-chain data

| On the local blockchain                   | Off-chain                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Buyer and supplier addresses              | Actual invoice files, kept by the parties                                                       |
| Description, quantity, ETH amount         | Interface role selection and form fields                                                        |
| Invoice's 32-byte SHA-256 hash            | Generated ABI/address configuration on disk                                                     |
| Funded/Shipped/Paid status, creation time | CSS, React components, explanations                                                             |
| Events, transaction hashes, escrow funds  | Public Hardhat development keys bundled in the app; selected wallet tied to the dashboard route |

SHA-256 is a one-way fingerprint, not encryption. Identical bytes give the same hash. Even a whitespace change normally gives a different hash. It neither proves a seller was honest nor proves that goods were delivered. The contract accepts the buyer's supplied hash and does not parse the invoice.

## 4. Restart and reconnect

Restart a validator using its terminal panel. Keep both databases and identities; no manual redeployment is needed. The website retries and gets the registered address from the nodes. If a node is absent, transactions pause. Both nodes are needed to resume block approval. The original Hardhat ledger remains separate and is used for isolated tests; the default website does not silently switch to it.

## 5. Four-person presentation, about 8 minutes

| Student | Responsibility                   | Show                                                                                                                                                |
| ------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Problem, scope, architecture     | Explain escrow, wallet identity, single-node limitation, and deliberate removal of independent verifier.                                            |
| 2       | Solidity and safety              | Explain struct, mapping, three states, permissions, checks-effects-interactions, reentrancy guard, events, and failed-transfer rollback. Run tests. |
| 3       | Buyer interface and hashing      | Connect Buyer, create/fund order, show registered hash and original/altered verification.                                                           |
| 4       | Supplier workflow and settlement | Connect Supplier, mark shipped; return to Buyer, release payment; show transaction hashes, limitations, and reset process.                          |

Everyone should understand the full flow and be able to explain their own part. Start TradeLock before presenting; both wallets are included, with no extension installation or unlock step.

## 6. Ten likely teacher questions

1. **Is this decentralized?** No. Ethereum-compatible contracts execute on one local Hardhat node controlled by this laptop. A public multi-node network would be a different deployment.
2. **Where is the money?** Test ETH stays in the contract until receipt confirmation, undisputed deadline release, or a mutually agreed payment/refund. It has no real value.
3. **Are these private user accounts?** No. Both development keys are public and anyone can select either wallet. Solidity enforces `msg.sender`, but this demo is not an authentication system. A production system would require proper wallet custody and access controls.
4. **Does Shipped prove delivery?** No. It is the supplier's claim. The buyer must confirm or dispute within 10 hours; silence permits release. This replaces the original independent verifier in this scope.
5. **What if the buyer never responds?** If shipped and undisputed, payment becomes eligible after 10 hours and the local worker submits it. A timely dispute freezes funds until the parties agree on payment or refund. Without that agreement, they remain locked.
6. **Why not store the invoice on-chain?** It costs more, exposes the full document, and is unnecessary for a file-integrity comparison. We store its SHA-256 fingerprint.
7. **Does a matching hash prove the invoice is true?** No. It only shows that the selected file's contents match the registered fingerprint.
8. **Can payment happen twice or consume another trade's funds?** Paid and Refunded are terminal. Each trade stores its own amount, and a successful payment/refund reduces `totalLocked` by exactly that amount. Tests cover mixed disputed/refunded/paid trades and reentry.
9. **What if the ETH transfer fails?** Solidity reverts the whole confirmation transaction. The trade stays Shipped and its funds stay locked; it can be retried if the supplier can accept ETH later. Reverted transactions may still spend gas.
10. **What happens when Hardhat restarts?** The in-memory ledger is lost. Run the launcher to redeploy, then refresh. The public test wallets still have the same addresses. This is not persistent production infrastructure.
