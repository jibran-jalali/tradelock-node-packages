import { before, test } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { verifyMessage, parseEther, Transaction } from "ethers";
import {
  DEMO_WALLETS,
  createLocalSigner,
  isDemoWalletId,
} from "../lib/local-wallet.ts";

let ethers;
before(async () => {
  ({ ethers } = await network.create());
});

test("built-in wallet keys resolve to the two funded Hardhat addresses", async () => {
  for (const id of ["buyer", "supplier"]) {
    const signer = await createLocalSigner(id, ethers.provider);
    assert.equal(signer.address, DEMO_WALLETS[id].address);
    assert.ok((await ethers.provider.getBalance(signer.address)) > 0n);
  }
});

test("native wallets refuse another chain before signing", async () => {
  const wrongChain = { getNetwork: async () => ({ chainId: 1n }) };
  await assert.rejects(
    createLocalSigner("buyer", wrongChain),
    /only sign on local chain 31337/,
  );
});

test("unknown wallet identities are rejected", async () => {
  for (const id of ["admin", "__proto__", "", null]) {
    assert.equal(isDemoWalletId(id), false);
    await assert.rejects(
      createLocalSigner(id, ethers.provider),
      /Choose a built-in development wallet/,
    );
  }
});

test("native wallet creates verifiable signatures and signed Ethereum transactions", async () => {
  const signer = await createLocalSigner("buyer", ethers.provider);
  const message = "TradeLock local wallet ownership test";
  assert.equal(
    verifyMessage(message, await signer.signMessage(message)),
    signer.address,
  );
  const raw = await signer.signTransaction({
    chainId: 31337,
    to: DEMO_WALLETS.supplier.address,
    value: 1n,
    nonce: 0,
    gasLimit: 21000n,
    gasPrice: 1000000000n,
    type: 0,
  });
  const transaction = Transaction.from(raw);
  assert.equal(transaction.from, DEMO_WALLETS.buyer.address);
  assert.equal(transaction.to, DEMO_WALLETS.supplier.address);
  assert.equal(transaction.chainId, 31337n);
});

test("native signers complete a real escrow trade and pay the supplier exactly", async () => {
  const buyer = await createLocalSigner("buyer", ethers.provider);
  const supplier = await createLocalSigner("supplier", ethers.provider);
  const escrow = await ethers.deployContract("TradeLock");
  await escrow.waitForDeployment();
  const hash = "0x" + "ab".repeat(32);
  await (
    await escrow
      .connect(buyer)
      .createTrade(supplier.address, "Native-wallet order", 20, hash, {
        value: parseEther("0.25"),
      })
  ).wait();
  assert.equal((await escrow.getTrade(1)).buyer, buyer.address);
  await (await escrow.connect(supplier).markShipped(1)).wait();
  const before = BigInt(
    await ethers.provider.send("eth_getBalance", [supplier.address, "latest"]),
  );
  await (await escrow.connect(buyer).confirmReceipt(1)).wait();
  const after = BigInt(
    await ethers.provider.send("eth_getBalance", [supplier.address, "latest"]),
  );
  assert.equal(after - before, parseEther("0.25"));
  assert.equal((await escrow.getTrade(1)).status, 2n);
  assert.equal(await escrow.totalLocked(), 0n);
});
