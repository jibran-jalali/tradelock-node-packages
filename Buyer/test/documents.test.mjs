import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hashDocument } from "../lib/hash.ts";

test("browser SHA-256 implementation matches the standard abc test vector", async () => {
  assert.equal(
    await hashDocument(new Blob(["abc"])),
    "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("original invoice matches itself; altered invoice does not match", async () => {
  const original = new Blob([
    await readFile("public/invoices/invoice-original.txt"),
  ]);
  const altered = new Blob([
    await readFile("public/invoices/invoice-altered.txt"),
  ]);
  const registered = await hashDocument(original);
  assert.equal(await hashDocument(original), registered);
  assert.notEqual(await hashDocument(altered), registered);
});
