import { sha256Hex } from "./sha256.js";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Canonical JSON: object keys sorted in UTF-16 code unit order (the default string sort),
 * no whitespace, JSON.stringify for strings and numbers, array order kept.
 *
 * The text is built by concatenation and never by assigning keys onto a new object, so
 * keys such as "__proto__" and "constructor" stay ordinary keys.
 */
export function canonicalJson(v: Json): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const keys = Object.keys(v).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const member = Object.getOwnPropertyDescriptor(v, key)?.value as Json;
    parts.push(JSON.stringify(key) + ":" + canonicalJson(member));
  }
  return "{" + parts.join(",") + "}";
}

/** True when JSON.parse(text) yields an object or an array (a JSON_Response). */
export function isJsonResponse(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  return typeof parsed === "object" && parsed !== null;
}

/** Lowercase hex SHA-256 of the Canonical_JSON text of a redacted input. */
export function inputHash(redactedInput: Json): string {
  return sha256Hex(canonicalJson(redactedInput));
}
