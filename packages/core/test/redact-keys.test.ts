// The sensitive-key rule, case by case. Jars are committed to git, so a key the rule misses is a
// secret in the repository. These cases are written out by hand and do not reuse the matcher.
import { describe, expect, it } from "vitest";
import { DEFAULT_REDACT_CONFIG, MARKER, compileRedact, keyMatcher, keyWords, redactInput, redactResponse } from "../src/redact.js";

const defaults = keyMatcher(DEFAULT_REDACT_CONFIG.keys);

describe("keyWords", () => {
  it("splits camelCase, PascalCase, snake_case, kebab-case, dotted and acronym keys the same way", () => {
    expect(keyWords("accessToken")).toEqual(["access", "token"]);
    expect(keyWords("Access-Token")).toEqual(["access", "token"]);
    expect(keyWords("ACCESS_TOKEN")).toEqual(["access", "token"]);
    expect(keyWords("auth.token")).toEqual(["auth", "token"]);
    expect(keyWords("XMLHttpToken")).toEqual(["xml", "http", "token"]);
    expect(keyWords("__proto__")).toEqual(["proto"]);
  });
});

describe("the default sensitive keys", () => {
  it.each([
    "authorization",
    "Authorization",
    "Proxy-Authorization",
    "password",
    "Password",
    "db_password",
    "secret",
    "client_secret",
    "clientSecret",
    "token",
    "Token",
    "access_token",
    "refreshToken",
    "X-Auth-Token",
    "api_key",
    "apiKey",
    "API_KEY",
    "x-api-key",
  ])("redacts %s", (key) => {
    expect(defaults.has(key)).toBe(true);
  });

  it.each(["tokens_used", "max_tokens", "room", "total_cents", "key", "api", "secretary", "passwords_checked"])(
    "keeps %s",
    (key) => {
      expect(defaults.has(key)).toBe(false);
    },
  );
});

describe("configured keys with no words", () => {
  it("match only themselves", () => {
    const m = keyMatcher(["__", "a/b~c"]);
    expect(m.has("__")).toBe(true);
    expect(m.has("_")).toBe(false);
    expect(m.has("a/b~c")).toBe(true);
    expect(m.has("room")).toBe(false);
  });
});

describe("capture redacts the canonical HTTP header spelling", () => {
  const compiled = compileRedact(DEFAULT_REDACT_CONFIG);
  if (!compiled.ok) throw new Error("default redact config does not compile");
  const c = compiled.value;

  it("in a tool input", () => {
    const { value, pointers } = redactInput({ headers: { Authorization: "Basic dXNlcjpwYXNz", Accept: "*/*" } }, c);
    expect(value).toEqual({ headers: { Authorization: MARKER, Accept: "*/*" } });
    expect(pointers).toEqual(["/headers/Authorization"]);
  });

  it("in a JSON response, editing only the value span", () => {
    const text = '{"accessToken": "eyJhbGciOi.abc", "total": 425.00}';
    const result = redactResponse(text, c);
    expect(result.responseText).toBe(`{"accessToken": "${MARKER}", "total": 425.00}`);
  });
});

describe("a string value that is itself JSON with a sensitive key", () => {
  const compiled = compileRedact(DEFAULT_REDACT_CONFIG);
  if (!compiled.ok) throw new Error("default redact config does not compile");
  const c = compiled.value;

  it("is replaced whole in a tool input", () => {
    const { value, pointers } = redactInput({ body: '{"password":"hunter2","user":"ada"}', note: "plain" }, c);
    expect(value).toEqual({ body: MARKER, note: "plain" });
    expect(pointers).toEqual(["/body"]);
  });

  it("is replaced whole when the key sits in a nested array or in doubly stringified JSON", () => {
    const inner = JSON.stringify({ items: [{ api_key: "k" }] });
    const { value } = redactInput({ a: inner, b: JSON.stringify({ wrapped: inner }) }, c);
    expect(value).toEqual({ a: MARKER, b: MARKER });

    // a2a round 07: fail closed at the inspection limit (nine wrappers past the first) and on
    // nesting too deep to walk; a pattern hidden behind a JSON escape is caught after decoding
    let wrapped = JSON.stringify({ token: "abc" });
    for (let i = 0; i < 10; i += 1) wrapped = JSON.stringify({ wrapped });
    const deep = `${"[".repeat(20000)}1${"]".repeat(20000)}`;
    const escaped = '{"note":"\\u0073k-abcdefghijklmnopqrstuvwxyz"}';
    expect(redactInput({ w: wrapped, d: deep, e: escaped }, c).value).toEqual({ w: MARKER, d: MARKER, e: MARKER });
    expect(redactResponse(JSON.stringify({ w: wrapped, d: deep, e: escaped, total: 425 }), c).responseText).toBe(
      `{"w":"${MARKER}","d":"${MARKER}","e":"${MARKER}","total":425}`,
    );
    // eight wrappers of clean JSON are inspected all the way down and kept
    let clean = JSON.stringify({ room: "r-02" });
    for (let i = 0; i < 8; i += 1) clean = JSON.stringify({ wrapped: clean });
    expect(redactInput({ clean }, c).value).toEqual({ clean });
  });

  it("is replaced whole in a JSON response, at the value span only", () => {
    const text = JSON.stringify({ content: '{"token":"abc"}', total: 425 });
    const result = redactResponse(text, c);
    expect(result.responseText).toBe(`{"content":"${MARKER}","total":425}`);
    expect(result.pointers).toEqual(["/content"]);
  });

  it("leaves JSON strings with no sensitive key, and malformed ones, alone", () => {
    const { value, pointers } = redactInput({ a: '{"tokens_used":3}', b: '{"password":', c: "[1,2]" }, c);
    expect(value).toEqual({ a: '{"tokens_used":3}', b: '{"password":', c: "[1,2]" });
    expect(pointers).toEqual([]);
  });
});
