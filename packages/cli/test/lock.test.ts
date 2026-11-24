import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockTimeout, withLock } from "../src/io/lock.js";

let base: string;
let lockPath: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "specimen-lock-")));
  lockPath = join(base, ".specimen", "lock");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Sets a file's modification time to `ageMs` in the past. */
function ageFile(path: string, ageMs: number): void {
  const when = (Date.now() - ageMs) / 1000;
  utimesSync(path, when, when);
}

describe("withLock", () => {
  it("a fresh held lock times out after 2 s, runs nothing and leaves the lock alone", async () => {
    mkdirSync(join(base, ".specimen"));
    writeFileSync(lockPath, "other-holder");

    const started = Date.now();
    let ran = false;

    await expect(
      withLock(lockPath, () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(LockTimeout);

    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(2000);
    expect(elapsed).toBeLessThan(3500);
    expect(ran).toBe(false);
    expect(readFileSync(lockPath, "utf8")).toBe("other-holder");
  });

  it("removes a stale lock older than 10 s and the retry succeeds", async () => {
    mkdirSync(join(base, ".specimen"));
    writeFileSync(lockPath, "dead-holder");
    ageFile(lockPath, 11_000);
    const started = Date.now();

    const result = await withLock(lockPath, () => 42);

    expect(result).toBe(42);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("holds the lock while the callback runs and releases it after success", async () => {
    const seenInside = await withLock(lockPath, () => existsSync(lockPath));

    expect(seenInside).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("releases the lock after the callback throws, and passes the error on", async () => {
    await expect(
      withLock(lockPath, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(existsSync(lockPath)).toBe(false);
  });

  it("does not remove a lock that now carries another nonce", async () => {
    await withLock(lockPath, () => {
      writeFileSync(lockPath, "taken-over-by-someone-else");
    });

    expect(readFileSync(lockPath, "utf8")).toBe("taken-over-by-someone-else");
  });

  it("makes a second caller wait until the first one releases", async () => {
    const order: string[] = [];
    const first = withLock(lockPath, async () => {
      order.push("first-in");
      await new Promise((resolve) => setTimeout(resolve, 150));
      order.push("first-out");
    });
    // Let the first caller take the lock before the second one starts.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = withLock(lockPath, () => {
      order.push("second-in");
    });

    await Promise.all([first, second]);

    expect(order).toEqual(["first-in", "first-out", "second-in"]);
  });
});
