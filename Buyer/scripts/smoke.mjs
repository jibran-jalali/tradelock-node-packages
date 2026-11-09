// Real local-node integration check. Creates a genuine paid trade, never a frontend fixture.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, parseEther } from "ethers";
import { hashDocument } from "../lib/hash.ts";

const d = JSON.parse(await readFile("lib/deployment.json", "utf8"));
const rpc = new JsonRpcProvider("http://127.0.0.1:8545", 31337, {
  staticNetwork: true,
  cacheTimeout: -1,
});
try {
  const buyer = await rpc.getSigner(0);
  const supplier = await rpc.getSigner(1);
  const c = new Contract(d.address, d.abi, buyer);
  const original = new Blob([
    await readFile("public/invoices/invoice-original.txt"),
  ]);
  const altered = new Blob([
    await readFile("public/invoices/invoice-altered.txt"),
  ]);
  const hash = await hashDocument(original);
  const created = await (
    await c.createTrade(
      await supplier.getAddress(),
      "Cotton shirts",
      20,
      hash,
      { value: parseEther("1") },
    )
  ).wait();
  const id = c.interface.parseLog(created.logs[0]).args.tradeId;
  assert.equal((await c.getTrade(id)).status, 0n);
  assert.equal(
    (await c.getTrade(id)).documentHash,
    await hashDocument(original),
  );
  assert.notEqual(
    (await c.getTrade(id)).documentHash,
    await hashDocument(altered),
  );
  const shipped = await (await c.connect(supplier).markShipped(id)).wait();
  const before = BigInt(
    await rpc.send("eth_getBalance", [await supplier.getAddress(), "latest"]),
  );
  const paid = await (await c.confirmReceipt(id)).wait();
  const after = BigInt(
    await rpc.send("eth_getBalance", [await supplier.getAddress(), "latest"]),
  );
  assert.equal(after - before, parseEther("1"));
  assert.equal((await c.getTrade(id)).status, 2n);
  assert.equal(await c.totalLocked(), 0n);
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        tradeId: id.toString(),
        contract: d.address,
        transactions: {
          created: created.hash,
          shipped: shipped.hash,
          paid: paid.hash,
        },
        supplierReceived: "1 test ETH",
        documentChecks: "original matches; altered differs",
      },
      null,
      2,
    ),
  );
} finally {
  rpc.destroy();
}
