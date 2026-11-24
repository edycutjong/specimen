import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/** How long a caller waits for the lock before it gives up. */
export const LOCK_TIMEOUT_MS = 2_000;

/** A lock file older than this (by modification time) is treated as left behind by a dead process. */
export const LOCK_STALE_MS = 10_000;

const RETRY_MIN_MS = 15;
const RETRY_MAX_MS = 40;

/** Thrown when the lock could not be acquired within LOCK_TIMEOUT_MS. */
export class LockTimeout extends Error {
  constructor() {
    super("lock timed out");
    this.name = "LockTimeout";
  }
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Creates the lock file exclusively and writes the nonce. Returns false when it already exists. */
async function tryCreate(path: string, nonce: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (err) {
    if (errorCode(err) === "EEXIST") return false;
    throw err;
  }
  try {
    await handle.writeFile(nonce, "utf8");
  } catch (err) {
    await handle.close().catch(() => undefined);
    await unlink(path).catch(() => undefined);
    throw err;
  }
  await handle.close();
  return true;
}

/**
 * Removes the lock file when its modification time is older than LOCK_STALE_MS. Returns true
 * when the caller should retry at once: the file was removed, or it vanished meanwhile.
 */
async function removeIfStale(path: string): Promise<boolean> {
  let modified: number;
  try {
    modified = (await stat(path)).mtimeMs;
  } catch (err) {
    if (errorCode(err) === "ENOENT") return true;
    throw err;
  }
  if (Date.now() - modified <= LOCK_STALE_MS) return false;
  try {
    await unlink(path);
  } catch (err) {
    if (errorCode(err) !== "ENOENT") throw err;
  }
  return true;
}

/**
 * Removes the lock file only when it still holds this caller's nonce. A failure here is
 * swallowed: an unremoved lock becomes stale after LOCK_STALE_MS and is then cleared.
 */
async function release(path: string, nonce: string): Promise<void> {
  try {
    const current = await readFile(path, "utf8");
    if (current !== nonce) return;
    await unlink(path);
  } catch {
    // Left for the staleness rule to clear.
  }
}

/**
 * Runs `fn` while holding the lock file at `path`. The lock is an exclusive create (`wx`)
 * that holds a random nonce. A lock older than LOCK_STALE_MS is removed. Waiting callers sleep
 * 15 to 40 ms between attempts. After LOCK_TIMEOUT_MS the call throws LockTimeout and leaves
 * any existing lock untouched. The lock is released after `fn` returns or throws.
 *
 * Residual risk: two processes may judge the same lock stale at the same moment, and one can
 * remove the other's fresh lock. The critical section lasts milliseconds against a 10 s
 * staleness limit, so this is accepted.
 */
export async function withLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const nonce = randomUUID();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    if (await tryCreate(path, nonce)) break;
    if (await removeIfStale(path)) continue;
    if (Date.now() >= deadline) throw new LockTimeout();
    await sleep(RETRY_MIN_MS + Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS));
  }

  try {
    return await fn();
  } finally {
    await release(path, nonce);
  }
}
