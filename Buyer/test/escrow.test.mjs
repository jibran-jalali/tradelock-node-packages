import { test, before } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

let ethers, buyer, supplier, outsider;
const hash = "0x" + "ab".repeat(32);
before(async () => {
  ({ ethers } = await network.create());
  [buyer, supplier, outsider] = await ethers.getSigners();
});
async function setup() {
  const escrow = await ethers.deployContract("TradeLock");
  await escrow.waitForDeployment();
  return escrow;
}
async function fund(escrow, address = supplier.address, amount = "1") {
  return (
    await escrow.createTrade(address, "Cotton shirts", 20, hash, {
      value: ethers.parseEther(amount),
    })
  ).wait();
}
async function balance(address) {
  // Raw RPC avoids provider caching while checking adjacent blocks.
  return BigInt(
    await ethers.provider.send("eth_getBalance", [address, "latest"]),
  );
}
test("complete trade pays exactly the escrow amount and emits all lifecycle events", async () => {
  const c = await setup();
  const created = await fund(c);
  assert.equal(c.interface.parseLog(created.logs[0]).name, "TradeCreated");
  const t = await c.getTrade(1);
  assert.equal(t.buyer, buyer.address);
  assert.equal(t.supplier, supplier.address);
  assert.equal(t.description, "Cotton shirts");
  assert.equal(t.quantity, 20n);
  assert.equal(t.documentHash, hash);
  assert.equal(t.status, 0n);
  const shipped = await (await c.connect(supplier).markShipped(1)).wait();
  assert.equal(c.interface.parseLog(shipped.logs[0]).name, "TradeShipped");
  const beforeBalance = await balance(supplier.address);
  const paid = await (await c.confirmReceipt(1)).wait();
  assert.equal(c.interface.parseLog(paid.logs[0]).name, "TradePaid");
  assert.equal(
    (await balance(supplier.address)) - beforeBalance,
    ethers.parseEther("1"),
  );
  assert.equal((await c.getTrade(1)).status, 2n);
  assert.equal(await c.totalLocked(), 0n);
  assert.equal(await balance(await c.getAddress()), 0n);
});
test("only assigned supplier can ship", async () => {
  const c = await setup();
  await fund(c);
  await assert.rejects(c.markShipped(1), /Supplier only/);
  await assert.rejects(c.connect(outsider).markShipped(1), /Supplier only/);
});
test("only buyer can release funds", async () => {
  const c = await setup();
  await fund(c);
  await c.connect(supplier).markShipped(1);
  await assert.rejects(c.connect(supplier).confirmReceipt(1), /Buyer only/);
  await assert.rejects(c.connect(outsider).confirmReceipt(1), /Buyer only/);
});
test("zero funding is rejected", async () => {
  const c = await setup();
  await assert.rejects(fund(c, supplier.address, "0"), /Funding required/);
});
test("zero, self, and escrow supplier addresses are rejected", async () => {
  const c = await setup();
  await assert.rejects(fund(c, ethers.ZeroAddress), /Invalid supplier/);
  await assert.rejects(fund(c, buyer.address), /Parties must differ/);
  await assert.rejects(fund(c, await c.getAddress()), /Invalid supplier/);
});
test("invalid description, quantity, and hash are rejected", async () => {
  const c = await setup();
  const options = { value: 1n };
  await assert.rejects(
    c.createTrade(supplier.address, "", 1, hash, options),
    /Invalid description/,
  );
  await assert.rejects(
    c.createTrade(supplier.address, "x".repeat(281), 1, hash, options),
    /Invalid description/,
  );
  await assert.rejects(
    c.createTrade(supplier.address, "Item", 0, hash, options),
    /Invalid quantity/,
  );
  await assert.rejects(
    c.createTrade(supplier.address, "Item", 1, ethers.ZeroHash, options),
    /Invoice hash required/,
  );
  assert.equal(await c.tradeCount(), 0n);
  assert.equal(await c.totalLocked(), 0n);
});
test("unknown trade IDs cannot be read or changed", async () => {
  const c = await setup();
  await assert.rejects(c.getTrade(0), /Unknown trade/);
  await assert.rejects(c.markShipped(1), /Unknown trade/);
  await assert.rejects(c.confirmReceipt(1), /Unknown trade/);
});
test("receipt before shipment and repeated shipment are rejected", async () => {
  const c = await setup();
  await fund(c);
  await assert.rejects(c.confirmReceipt(1), /Must be shipped/);
  await c.connect(supplier).markShipped(1);
  await assert.rejects(c.connect(supplier).markShipped(1), /Must be funded/);
});
test("paid trades cannot be shipped or paid again", async () => {
  const c = await setup();
  await fund(c);
  await c.connect(supplier).markShipped(1);
  await c.confirmReceipt(1);
  await assert.rejects(c.confirmReceipt(1), /Must be shipped/);
  await assert.rejects(c.connect(supplier).markShipped(1), /Must be funded/);
});
test("multiple trades keep independent balances and parties", async () => {
  const c = await setup();
  await fund(c);
  await fund(c, outsider.address, "2");
  assert.equal(await c.totalLocked(), ethers.parseEther("3"));
  await c.connect(supplier).markShipped(1);
  await c.confirmReceipt(1);
  assert.equal(await c.totalLocked(), ethers.parseEther("2"));
  assert.equal(await balance(await c.getAddress()), ethers.parseEther("2"));
  assert.equal((await c.getTrade(2)).status, 0n);
  await assert.rejects(c.connect(supplier).markShipped(2), /Supplier only/);
  await c.connect(outsider).markShipped(2);
  await c.confirmReceipt(2);
  assert.equal(await c.totalLocked(), 0n);
});
test("failed supplier transfer rolls back status/accounting and can be retried", async () => {
  const c = await setup();
  const receiver = await ethers.deployContract("TestSupplier", [
    await c.getAddress(),
  ]);
  await receiver.configure(true, false, 1);
  await fund(c, await receiver.getAddress());
  await receiver.ship(1);
  await assert.rejects(c.confirmReceipt(1), /Supplier transfer failed/);
  assert.equal((await c.getTrade(1)).status, 1n);
  assert.equal(await c.totalLocked(), ethers.parseEther("1"));
  assert.equal(await balance(await c.getAddress()), ethers.parseEther("1"));
  await receiver.configure(false, false, 1);
  await c.confirmReceipt(1);
  assert.equal((await c.getTrade(1)).status, 2n);
});
test("authorized supplier callback cannot reenter payment on another trade", async () => {
  const c = await setup();
  const receiver = await ethers.deployContract("TestSupplier", [
    await c.getAddress(),
  ]);
  await fund(c, await receiver.getAddress());
  await receiver.buy(outsider.address, hash, { value: ethers.parseEther("2") });
  await c.connect(outsider).markShipped(2);
  await receiver.configure(false, true, 2);
  await receiver.ship(1);
  await c.confirmReceipt(1);
  assert.equal(await receiver.reentrySucceeded(), false);
  assert.equal(
    await balance(await receiver.getAddress()),
    ethers.parseEther("1"),
  );
  assert.equal((await c.getTrade(2)).status, 1n);
  assert.equal(await c.totalLocked(), ethers.parseEther("2"));
});
