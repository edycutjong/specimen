import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/index.js";

describe("sha256Hex", () => {
  it("matches the published test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("agrees with node:crypto around the padding block boundaries", () => {
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const text = "x".repeat(length);
      const reference = createHash("sha256").update(text, "utf8").digest("hex");
      expect(sha256Hex(text)).toBe(reference);
    }
  });

  it("hashes UTF-8 bytes of multi-byte text", () => {
    const text = "room r-04 \u00e9\u4e2d\ud83d\ude00";
    expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });

  it("accepts a Uint8Array and matches the string form of the same bytes", () => {
    const bytes = new TextEncoder().encode("jar bytes");
    expect(sha256Hex(bytes)).toBe(sha256Hex("jar bytes"));
  });
});
