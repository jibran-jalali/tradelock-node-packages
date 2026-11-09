import { before, test } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { releaseOverdueTrades } from "../scripts/settlement-worker.mjs";
import {
  canDispute,
  canReleaseAfterDeadline,
  isEscrowLocked,
  remainingTime,
  readChainTimestamp,
} from "../lib/trade-rules.ts";

let ethers, buyer, supplier, outsider;
const hash = "0x" + "ab".repeat(32);
before(async () => {
  ({ ethers } = await network.create());
  [buyer, supplier, outsider] = await ethers.getSigners();
});
async function setup() {
  const c = await ethers.deployContract("TradeLock");
  await c.waitForDeployment();
  return c;
}
async function fund(c, receiver = supplier.address, amount = "1") {
  await (
    await c.createTrade(receiver, "Test order", 10, hash, {
      value: ethers.parseEther(amount),
    })
  ).wait();
  return Number(await c.tradeCount());
}
async function ship(c, id = 1) {
  await (await c.connect(supplier).markShipped(id)).wait();
  return Number((await c.getTrade(id)).releaseDeadline);
}
async function at(timestamp) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
}
async function mineAt(timestamp) {
  await at(timestamp);
  await ethers.provider.send("evm_mine", []);
}
async function balance(address) {
  return BigInt(
    await ethers.provider.send("eth_getBalance", [address, "latest"]),
  );
}

test("shipment starts exactly one ten-hour window, not order creation", async () => {
  const c = await setup();
  await fund(c);
  assert.equal((await c.getTrade(1)).releaseDeadline, 0n);
  await ethers.provider.send("evm_increaseTime", [50000]);
  await ethers.provider.send("evm_mine", []);
  const deadline = await ship(c);
  const t = await c.getTrade(1);
  assert.equal(await c.RECEIPT_WINDOW(), 36000n);
  assert.equal(BigInt(deadline) - t.shippedAt, 36000n);
  await assert.rejects(c.claimPayment(1), /Receipt window active/);
  await assert.rejects(c.connect(supplier).markShipped(1), /Must be funded/);
  assert.equal((await c.getTrade(1)).releaseDeadline, BigInt(deadline));
});

test("no claim at deadline minus one second; exact deadline permits safe permissionless release", async () => {
  const c = await setup();
  await fund(c);
  const deadline = await ship(c);
  await at(deadline - 1);
  await assert.rejects(async () => {
    await (await c.claimPayment(1, { gasLimit: 300000 })).wait();
  }, /Receipt window active/);
  const beforeBalance = await balance(supplier.address);
  await at(deadline);
  await (await c.connect(outsider).claimPayment(1)).wait();
  assert.equal(
    (await balance(supplier.address)) - beforeBalance,
    ethers.parseEther("1"),
  );
  assert.equal((await c.getTrade(1)).status, 2n);
  assert.equal(await c.totalLocked(), 0n);
  await assert.rejects(c.claimPayment(1), /Must be shipped/);
  await assert.rejects(c.confirmReceipt(1), /Must be shipped/);
});

test("buyer can confirm early or late, but a paid trade cannot be disputed", async () => {
  const c = await setup();
  await fund(c);
  const deadline = await ship(c);
  await at(deadline + 1);
  await (await c.confirmReceipt(1)).wait();
  await assert.rejects(c.raiseDispute(1, "Not received"), /Must be shipped/);
  assert.equal(await c.totalLocked(), 0n);
});

test("only the buyer can dispute; a timely complaint blocks every deadline release", async () => {
  const c = await setup();
  await fund(c);
  const deadline = await ship(c);
  await assert.rejects(
    c.connect(supplier).raiseDispute(1, "Complaint"),
    /Buyer only/,
  );
  await assert.rejects(
    c.connect(outsider).raiseDispute(1, "Complaint"),
    /Buyer only/,
  );
  await at(deadline - 1);
  const receipt = await (await c.raiseDispute(1, "Goods not received")).wait();
  assert.equal(c.interface.parseLog(receipt.logs[0]).name, "DisputeOpened");
  assert.equal((await c.getTrade(1)).disputeReason, "Goods not received");
  await mineAt(deadline + 100000);
  await assert.rejects(c.claimPayment(1), /Must be shipped/);
  await assert.rejects(c.confirmReceipt(1), /Must be shipped/);
  await assert.rejects(c.connect(supplier).markShipped(1), /Must be funded/);
  assert.equal(await c.totalLocked(), ethers.parseEther("1"));
});

test("disputes at or after the exact deadline cannot race an eligible payment", async () => {
  const c = await setup();
  await fund(c);
  const deadline = await ship(c);
  await at(deadline);
  await assert.rejects(async () => {
    await (await c.raiseDispute(1, "Late", { gasLimit: 300000 })).wait();
  }, /Receipt window ended/);
  await (await c.claimPayment(1)).wait();
  assert.equal((await c.getTrade(1)).status, 2n);
});

test("invalid dispute reasons and unshipped/unknown complaints are rejected", async () => {
  const c = await setup();
  await fund(c);
  await assert.rejects(c.raiseDispute(1, "Not shipped"), /Must be shipped/);
  await assert.rejects(c.raiseDispute(99, "Missing"), /Unknown trade/);
  await ship(c);
  await assert.rejects(c.raiseDispute(1, ""), /Invalid dispute reason/);
  await assert.rejects(
    c.raiseDispute(1, "x".repeat(281)),
    /Invalid dispute reason/,
  );
  await c.raiseDispute(1, "Valid");
  await assert.rejects(c.raiseDispute(1, "Again"), /Must be shipped/);
});

test("disputed payment requires the other party's approval and pays once", async () => {
  const c = await setup();
  await fund(c);
  await ship(c);
  await c.raiseDispute(1, "Quality issue");
  await c.proposeResolution(1, 1);
  await assert.rejects(
    c.acceptResolution(1, 1, buyer.address),
    /Other party must approve/,
  );
  const beforeBalance = await balance(supplier.address);
  // The supplier pays gas for acceptance; account for it when checking receipt.
  const receipt = await (
    await c.connect(supplier).acceptResolution(1, 1, buyer.address)
  ).wait();
  assert.equal(
    (await balance(supplier.address)) -
      beforeBalance +
      receipt.gasUsed * receipt.gasPrice,
    ethers.parseEther("1"),
  );
  assert.equal((await c.getTrade(1)).status, 2n);
  assert.equal(await c.totalLocked(), 0n);
  await assert.rejects(
    c.connect(supplier).acceptResolution(1, 1, buyer.address),
    /Resolution unavailable/,
  );
});

test("a mutually agreed dispute refund returns exactly the escrow and is terminal", async () => {
  const c = await setup();
  await fund(c);
  await ship(c);
  await c.raiseDispute(1, "Not received");
  await c.connect(supplier).proposeResolution(1, 2);
  const beforeBalance = await balance(buyer.address);
  const receipt = await (
    await c.acceptResolution(1, 2, supplier.address)
  ).wait();
  assert.equal(
    (await balance(buyer.address)) -
      beforeBalance +
      receipt.gasUsed * receipt.gasPrice,
    ethers.parseEther("1"),
  );
  assert.equal((await c.getTrade(1)).status, 4n);
  assert.equal(await c.totalLocked(), 0n);
  await assert.rejects(c.claimPayment(1), /Must be shipped/);
  await assert.rejects(c.proposeResolution(1, 1), /Resolution unavailable/);
});

test("funded cancellation requires mutual agreement and cannot pay before shipment", async () => {
  const c = await setup();
  await fund(c);
  await assert.rejects(
    c.proposeResolution(1, 1),
    /Unshipped trades can only refund/,
  );
  await c.proposeResolution(1, 2);
  await assert.rejects(
    c.acceptResolution(1, 2, buyer.address),
    /Other party must approve/,
  );
  await c.connect(supplier).acceptResolution(1, 2, buyer.address);
  assert.equal((await c.getTrade(1)).status, 4n);
  await assert.rejects(c.connect(supplier).markShipped(1), /Must be funded/);
});

test("outsiders, missing proposals, and None resolutions cannot settle escrow", async () => {
  const c = await setup();
  await fund(c);
  await assert.rejects(
    c.connect(outsider).proposeResolution(1, 2),
    /Trade parties only/,
  );
  await assert.rejects(c.proposeResolution(1, 0), /Choose a resolution/);
  await assert.rejects(
    c.acceptResolution(1, 2, supplier.address),
    /No proposal/,
  );
  await c.proposeResolution(1, 2);
  await assert.rejects(
    c.connect(outsider).acceptResolution(1, 2, buyer.address),
    /Trade parties only/,
  );
  await assert.rejects(
    c.connect(supplier).cancelResolution(1),
    /Proposer only/,
  );
});

test("cancelled, changed, and counterproposed outcomes cannot use stale approvals", async () => {
  const c = await setup();
  await fund(c);
  await ship(c);
  await c.raiseDispute(1, "Issue");
  await c.proposeResolution(1, 1);
  await c.proposeResolution(1, 2);
  await assert.rejects(
    c.connect(supplier).acceptResolution(1, 1, buyer.address),
    /Proposal changed/,
  );
  await c.cancelResolution(1);
  await assert.rejects(
    c.connect(supplier).acceptResolution(1, 2, buyer.address),
    /No proposal/,
  );
  await c.proposeResolution(1, 2);
  await c.connect(supplier).proposeResolution(1, 1);
  await assert.rejects(
    c.acceptResolution(1, 2, buyer.address),
    /Proposal changed/,
  );
  assert.equal(await c.totalLocked(), ethers.parseEther("1"));
});

test("shipment invalidates an unaccepted cancellation request", async () => {
  const c = await setup();
  await fund(c);
  await c.proposeResolution(1, 2);
  await ship(c);
  assert.equal((await c.getTrade(1)).proposedResolution, 0n);
  await assert.rejects(
    c.connect(supplier).acceptResolution(1, 2, buyer.address),
    /Resolution unavailable/,
  );
});

test("disputed, refunded and paid trades keep other escrow funds isolated", async () => {
  const c = await setup();
  await fund(c);
  await fund(c, supplier.address, "2");
  await fund(c, supplier.address, "3");
  await ship(c, 1);
  await c.raiseDispute(1, "Issue");
  await c.proposeResolution(2, 2);
  await c.connect(supplier).acceptResolution(2, 2, buyer.address);
  const deadline = await ship(c, 3);
  await mineAt(deadline);
  await c.connect(outsider).claimPayment(3);
  assert.equal(await c.totalLocked(), ethers.parseEther("1"));
  assert.equal(await balance(await c.getAddress()), ethers.parseEther("1"));
  assert.equal((await c.getTrade(1)).status, 3n);
});

test("failed deadline transfers roll back state and remain retryable", async () => {
  const c = await setup();
  const receiver = await ethers.deployContract("TestSupplier", [
    await c.getAddress(),
  ]);
  await receiver.configure(true, false, 1);
  await fund(c, await receiver.getAddress());
  await receiver.ship(1);
  await mineAt(Number((await c.getTrade(1)).releaseDeadline));
  await assert.rejects(c.claimPayment(1), /Supplier transfer failed/);
  assert.equal((await c.getTrade(1)).status, 1n);
  assert.equal(await c.totalLocked(), ethers.parseEther("1"));
  await receiver.configure(false, false, 1);
  await c.claimPayment(1);
  assert.equal(await c.totalLocked(), 0n);
});

test("failed buyer refund restores proposal and escrow until successful retry", async () => {
  const c = await setup();
  const receiver = await ethers.deployContract("TestSupplier", [
    await c.getAddress(),
  ]);
  await receiver.buy(supplier.address, hash, { value: ethers.parseEther("1") });
  await receiver.configure(true, false, 1);
  await c.connect(supplier).proposeResolution(1, 2);
  await assert.rejects(
    receiver.accept(1, 2, supplier.address),
    /Buyer transfer failed/,
  );
  assert.equal((await c.getTrade(1)).status, 0n);
  assert.equal((await c.getTrade(1)).proposedResolution, 2n);
  assert.equal(await c.totalLocked(), ethers.parseEther("1"));
  await receiver.configure(false, false, 1);
  await receiver.accept(1, 2, supplier.address);
  assert.equal((await c.getTrade(1)).status, 4n);
  assert.equal(await c.totalLocked(), 0n);
});

test("refund callbacks cannot reenter another authorized buyer trade", async () => {
  const c = await setup();
  const receiver = await ethers.deployContract("TestSupplier", [
    await c.getAddress(),
  ]);
  await receiver.buy(supplier.address, hash, { value: ethers.parseEther("1") });
  await receiver.buy(outsider.address, hash, { value: ethers.parseEther("2") });
  await c.connect(outsider).markShipped(2);
  await receiver.configure(false, true, 2);
  await c.connect(supplier).proposeResolution(1, 2);
  await receiver.accept(1, 2, supplier.address);
  assert.equal(await receiver.reentrySucceeded(), false);
  assert.equal((await c.getTrade(2)).status, 1n);
  assert.equal(await c.totalLocked(), ethers.parseEther("2"));
});

test("failed disputed supplier payment restores the accepted proposal for retry", async () => {
  const c = await setup();
  const receiver = await ethers.deployContract("TestSupplier", [
    await c.getAddress(),
  ]);
  await fund(c, await receiver.getAddress());
  await receiver.ship(1);
  await c.raiseDispute(1, "Issue");
  await receiver.propose(1, 1);
  await receiver.configure(true, false, 1);
  await assert.rejects(
    c.acceptResolution(1, 1, await receiver.getAddress()),
    /Supplier transfer failed/,
  );
  assert.equal((await c.getTrade(1)).status, 3n);
  assert.equal((await c.getTrade(1)).proposedResolution, 1n);
  assert.equal(await c.totalLocked(), ethers.parseEther("1"));
  await receiver.configure(false, false, 1);
  await c.acceptResolution(1, 1, await receiver.getAddress());
  assert.equal((await c.getTrade(1)).status, 2n);
  assert.equal(await c.totalLocked(), 0n);
});

test("actual settlement worker releases only overdue undisputed trades and is idempotent", async () => {
  const c = await setup();
  await fund(c);
  await fund(c);
  await fund(c);
  await ship(c, 1);
  await ship(c, 2);
  await c.raiseDispute(2, "Not received");
  const deadline = Number((await c.getTrade(1)).releaseDeadline);
  const before = await releaseOverdueTrades(c.connect(outsider), deadline - 1);
  assert.equal(before.released.length, 0);
  await mineAt(deadline + 1);
  const after = await releaseOverdueTrades(c.connect(outsider), deadline + 1);
  assert.equal(after.released.length, 1);
  assert.equal((await c.getTrade(2)).status, 3n);
  assert.equal((await c.getTrade(3)).status, 0n);
  assert.equal(await c.totalLocked(), ethers.parseEther("2"));
  assert.equal(
    (await releaseOverdueTrades(c.connect(outsider), deadline + 2)).released
      .length,
    0,
  );
});

test("worker cannot override the on-chain deadline with an incorrect local clock", async () => {
  const c = await setup();
  await fund(c);
  const deadline = await ship(c);
  const result = await releaseOverdueTrades(c.connect(outsider), deadline + 1);
  assert.equal(result.released.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal((await c.getTrade(1)).status, 1n);
});

test("worker isolates failed transfers and continues with other eligible trades", async () => {
  const c = await setup();
  const receiver = await ethers.deployContract("TestSupplier", [
    await c.getAddress(),
  ]);
  await receiver.configure(true, false, 1);
  await fund(c, await receiver.getAddress());
  await receiver.ship(1);
  await fund(c);
  const deadline = await ship(c, 2);
  await mineAt(deadline + 1);
  const result = await releaseOverdueTrades(c.connect(outsider), deadline + 1);
  assert.equal(result.released.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal((await c.getTrade(1)).status, 1n);
  assert.equal((await c.getTrade(2)).status, 2n);
  assert.equal(await c.totalLocked(), ethers.parseEther("1"));
});

test("display helpers agree with exact deadline boundaries and terminal accounting", () => {
  assert.equal(canDispute(1, 36000, 35999), true);
  assert.equal(canDispute(1, 36000, 36000), false);
  assert.equal(canReleaseAfterDeadline(1, 36000, 36000), true);
  assert.equal(canReleaseAfterDeadline(3, 36000, 50000), false);
  assert.equal(isEscrowLocked(3), true);
  assert.equal(isEscrowLocked(2), false);
  assert.equal(isEscrowLocked(4), false);
  assert.equal(remainingTime(36000, 0), "10:00:00");
  assert.equal(remainingTime(36000, 36001), "00:00:00");
});

test("clock reader accepts null pending block numbers and rejects malformed timestamps", async () => {
  assert.ok(Number.isSafeInteger(await readChainTimestamp(ethers.provider)));
  assert.equal(
    await readChainTimestamp({
      send: async () => ({ number: null, timestamp: "0x8ca0" }),
    }),
    36000,
  );
  await assert.rejects(
    readChainTimestamp({ send: async () => null }),
    /clock unavailable/,
  );
  await assert.rejects(
    readChainTimestamp({ send: async () => ({ timestamp: "invalid" }) }),
    /clock unavailable/,
  );
});
