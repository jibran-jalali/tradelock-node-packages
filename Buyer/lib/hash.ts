// The file stays on this device. SHA-256 fingerprints the exact bytes, including whitespace.
export async function hashDocument(file: Blob): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return (
    "0x" +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}
