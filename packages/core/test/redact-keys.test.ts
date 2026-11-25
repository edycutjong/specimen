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
