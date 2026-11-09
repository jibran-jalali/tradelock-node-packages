# Escrow and conflict rules

The contract is authoritative. Interface buttons, browser timers, and the worker cannot override it.

| Situation                     | Rule enforced by Solidity                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Funded order                  | Only the assigned supplier can mark it shipped. No receipt timer exists yet.                                                                                                                                                                       |
| Shipment                      | Store `shippedAt` once and `releaseDeadline = shippedAt + 36,000 seconds`. Repeated shipment cannot restart the timer.                                                                                                                             |
| Buyer confirms receipt        | Only that buyer may release payment while Shipped. Confirmation may happen before or after the deadline if no payment/dispute has already won.                                                                                                     |
| Buyer is silent for 10 hours  | Any account may call `claimPayment`; the entire escrow goes to the stored supplier, never to the caller.                                                                                                                                           |
| Buyer reports Not received    | This sends `raiseDispute` with that reason; it must be confirmed before the deadline. Payment becomes frozen and the dispute page opens.                                                                                                           |
| Buyer reports another issue   | `raiseDispute` requires a nonempty reason of at most 280 UTF-8 bytes. It has the same timing and payment-freeze rules.                                                                                                                             |
| At exactly the deadline       | `block.timestamp >= releaseDeadline` permits payment. A dispute requires `< releaseDeadline` and is too late at equality.                                                                                                                          |
| Timely dispute                | Status becomes Disputed. `claimPayment`, receipt confirmation, and re-shipment are all blocked, even after 10 hours or longer.                                                                                                                     |
| Proposed dispute outcome      | Either party can propose paying the supplier or refunding the buyer. A proposal transfers nothing.                                                                                                                                                 |
| Approval                      | The other party must accept the exact proposed outcome and proposer address. One person cannot approve their own proposal.                                                                                                                         |
| Changed or withdrawn proposal | A stale acceptance reverts. The proposer can withdraw; either party can counterpropose before acceptance.                                                                                                                                          |
| Unshipped cancellation        | Either party can request a refund, and the other party must accept it. Paying an unshipped order through resolution is forbidden. A pending request is not an agreed cancellation and does not prevent shipment. Shipment clears the old proposal. |
| Final payment or refund       | Paid and Refunded are terminal. No later complaint, shipment, proposal, payment, or refund can change the outcome.                                                                                                                                 |
| Failed recipient transfer     | Revert everything: status, proposal, accounting, and events. Funds remain locked and the same action can be retried if the receiver later accepts ETH.                                                                                             |
| Concurrent transactions       | Mining order decides. State/time checks allow only a valid winning transition. Duplicate payouts cannot happen.                                                                                                                                    |
| Separate trades               | Each trade stores its own amount; `totalLocked` includes Funded, Shipped, and Disputed, and excludes Paid/Refunded.                                                                                                                                |
| Reentrancy                    | Every mutation has a guard. Status/accounting updates happen before the external payment.                                                                                                                                                          |

## Automatic release

The free local settlement worker checks approximately every 10 seconds. It reads Hardhat's pending block time, finds overdue Shipped trades, and submits real signed `claimPayment` transactions. It never resolves disputes and has no special administrator permission. The public Supplier development account pays the worker's gas; recipient addresses always come from the contract.

The launcher starts/reuses it automatically. With manual terminals, run:

```powershell
Set-Location 'D:\Desktop\tradelock'
npm.cmd run settle
```

Logs, PID, and heartbeat are in `.runtime/settlement.log`, `.runtime/settlement.pid`, and `.runtime/settlement-status.json`. If it stops, eligible payments remain safely claimable through the supplier's **Claim payment** button. On restart, the worker catches up. The blockchain and worker must remain running; release occurs shortly after eligibility, not at a guaranteed wall-clock millisecond. Sleep, node outages, insufficient gas, and rejected receiver transfers can delay a transaction. The contract never releases early.

## Dispute pages

- Buyer opens `/disputes/TRADE_ID?role=buyer` after a confirmed complaint.
- Supplier opens the same trade through **View dispute** on `/supplier`, with `?role=supplier`.
- Each page uses its corresponding built-in wallet. These are intentionally public test wallets, not private authentication.
- One party proposes **Pay supplier** or **Refund buyer**. The other reviews and accepts the exact outcome in a separate on-chain transaction.
- Without cooperation, funds remain locked indefinitely. This two-party system does not decide who is telling the truth. Independent arbitration, partial settlements, shipping deadlines, and automatic delivery proof are outside this implementation.
- The buyer must submit the actual complaint transaction before the deadline; opening a form, clicking a button, or cancelling the signing dialog is not an on-chain response.

Shipment remains the supplier's claim. A silent buyer can lose access to escrow after 10 hours even if goods have not arrived. This is the requested business rule, not proof of delivery. Hashes similarly prove file integrity, not truth.

## Deployment and testing

Contract code at an existing address cannot be replaced by editing Solidity. The updated rules use a new deployment and automatically generated ABI/configuration. The deploy script archives the previous configuration and refuses to switch while old `totalLocked` is nonzero. Old trades stay at the old contract, and previous history is not migrated. The local blockchain was not reset for this update.

Automated tests advance time only in isolated Hardhat networks. They test one second before, exactly at, and after the deadline without waiting 10 real hours or moving the running demo chain's clock. Tests also run the actual worker payout function against that isolated chain. There is no shortened on-chain timer or fake frontend success.

References: [Solidity time units and block timestamp](https://docs.soliditylang.org/en/latest/units-and-global-variables.html), [why smart-contract automation needs transactions](https://chain.link/education-hub/smart-contract-automation).
