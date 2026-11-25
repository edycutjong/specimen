/**
 * Task 10.1. Requirements 16.7, 16.9, 16.12, 17.1, 17.2, 17.3, 17.6. Design: `build-scan.test.ts`.
 *
 * Node environment. Runs `npm run build -w apps/cabinet` from the repository root, then scans `apps/cabinet/dist/`:
 * - HTML and CSS: no `src`, `href`, `url()` or `@import` holds an absolute URL, except an `<a href>` to github.com.
 * - JavaScript: every host named by an absolute `http(s)://` URL is github.com, an own site host, a Namespace_Host, or a
 *   named exception (JS_HOST_EXCEPTIONS). Each exception may appear only as a string literal, near no network call.
 * - CSS and inline JS styles: no font size below 14 px after rem and em conversion.
 * - The three font families ship as local files.
 * - Social and icon metadata name only files inside Dist.
 * - Every file under `jars/` matches `jars/MANIFEST.sha256`.
 *
 * Assumptions and limits:
 * - rem and em are converted with a 16 px root. A nested em is not compounded, so this does not catch a child of a
 *   small parent. A value this scanner cannot resolve (for example `var(--x)` or `calc()`) fails the test.
 * - The own site host is empty. The repo does not fix a deploy domain. Dist refers to itself with root-relative
 *   paths, so the bundle names no own host.
 * - JavaScript hosts come from `scheme://host` only. Protocol-relative strings in JavaScript are not scanned.
 * - The paths in the manifest are relative to `jars/`. The check resolves them against that directory and does not
 *   change the working directory.
 * - The scan reads Dist only. It does not check layout, colours or runtime requests. The jsdom network guard covers runtime calls.
 *
 * The repository root is `process.cwd()`, which is where `npm test` runs.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import * as ts from "typescript";

const ROOT = process.cwd();
const DIST = join(ROOT, "apps", "cabinet", "dist");
const JARS = join(ROOT, "jars");
const MANIFEST_NAME = "MANIFEST.sha256";
const BUILD_TIMEOUT_MS = 300_000;

/** Hosts that Dist may name in JavaScript. Namespace_Hosts appear only as identifiers and are never requested. */
const GITHUB_HOST = "github.com";
const NAMESPACE_HOSTS = ["www.w3.org", "json-schema.org", "react.dev"] as const;
/** The deployed site host. The repo does not fix one yet, so the list stays empty. */
const OWN_SITE_HOSTS: readonly string[] = [];
const ALLOWED_JS_HOSTS = new Set<string>([GITHUB_HOST, ...NAMESPACE_HOSTS, ...OWN_SITE_HOSTS]);

/**
 * EXCEPTIONS to the allowlist above. Each host is named in a library's JavaScript as a string, and nothing requests it.
 * The JavaScript test also checks that every occurrence is a string literal near no network call (see
 * `exceptionProblems`). None may appear in HTML or CSS. Added by an explicit exception. Requirement 16.7 is unchanged.
 */
const JS_HOST_EXCEPTIONS: readonly string[] = [
  // Library identifier: ajv, the JSON-schema validator used by @modelcontextprotocol/sdk, names it as a `$ref`. Not fetched.
  "raw.githubusercontent.com",
];

/** Calls that would send a request or load a resource. A literal passed to one of these fails the exception check. */
const NETWORK_CALLEES = new Set([
  "fetch",
  "import",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "open",
  "sendBeacon",
  "importScripts",
  "setAttribute",
]);
/** Properties that load a resource when a string is assigned to them. */
const NETWORK_PROPERTIES = new Set(["src", "href", "srcset"]);

const MIN_FONT_PX = 14;
const ROOT_FONT_PX = 16;
const FAMILIES = ["Atkinson Hyperlegible Next", "Azeret Mono", "Grenze Gotisch"] as const;

interface DistFile {
  /** Path relative to Dist, with `/` separators. */
  readonly rel: string;
  readonly abs: string;
  readonly text: string;
}

/**
 * Runs the production build into a clean Dist. Vitest sets NODE_ENV=test, and React picks its development build when
 * NODE_ENV is not production. So the child process gets NODE_ENV=production explicitly, and the old Dist is removed
 * first so the scan never reads a stale bundle. A failed build throws, and that failure fails `beforeAll`.
 */
function runBuild(): void {
  rmSync(DIST, { recursive: true, force: true });
  try {
    execSync("npm run build -w apps/cabinet", {
      cwd: ROOT,
      stdio: "pipe",
      timeout: BUILD_TIMEOUT_MS,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production" },
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(`cabinet build failed:\n${stderr.slice(-2000)}`);
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function readDist(): DistFile[] {
  return walk(DIST).map((abs) => ({
    rel: relative(DIST, abs).split(sep).join("/"),
    abs,
    text: readFileSync(abs, "utf8"),
  }));
}

/** Absolute means a scheme (`https:`) or a protocol-relative `//host`. `data:` is inline content, not a request. */
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** The host of an absolute URL, lower case, without port. Returns undefined when there is no `//host` part. */
function hostOf(url: string): string | undefined {
  const match = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#\s]+)/i.exec(url.trim());
  if (!match) return undefined;
  const authority = (match[1] ?? "").split("@").pop() ?? "";
  return authority.replace(/:\d+$/, "").toLowerCase();
}

function isAbsoluteRequest(value: string): boolean {
  const trimmed = value.trim();
  return ABSOLUTE.test(trimmed) && !/^data:/i.test(trimmed);
}

/** Reads the value of an attribute from a tag's attribute text, or undefined. */
function attrValue(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

/** Every `url(...)` argument in a stylesheet or HTML text, with quotes removed. */
function cssUrls(text: string): string[] {
  return [...text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
}

/** Every `@import` target in a stylesheet. */
function cssImports(text: string): string[] {
  return [...text.matchAll(/@import\b([^;]*)/gi)].map((m) => {
    const body = m[1] ?? "";
    const quoted = /["']([^"']*)["']/.exec(body);
    if (quoted) return quoted[1] ?? "";
    const fn = /url\(\s*([^)]*)\)/i.exec(body);
    return (fn?.[1] ?? "").replace(/["']/g, "").trim();
  });
}

/** HTML and CSS violations: src, href, url() or @import with an absolute URL, except a github.com anchor href. */
function referenceViolations(file: DistFile): string[] {
  const violations: string[] = [];
  const isHtml = file.rel.endsWith(".html");
  if (isHtml) {
    for (const tag of file.text.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
      const name = (tag[1] ?? "").toLowerCase();
      const attrs = tag[2] ?? "";
      for (const attr of ["src", "href"] as const) {
        const value = attrValue(attrs, attr);
        if (value === undefined || !isAbsoluteRequest(value)) continue;
        const isGithubAnchor = name === "a" && attr === "href" && hostOf(value) === GITHUB_HOST;
        if (!isGithubAnchor) violations.push(`${file.rel}: <${name} ${attr}="${value}">`);
      }
    }
  }
  for (const url of cssUrls(file.text)) {
    if (isAbsoluteRequest(url)) violations.push(`${file.rel}: url(${url})`);
  }
  for (const target of cssImports(file.text)) {
    if (isAbsoluteRequest(target)) violations.push(`${file.rel}: @import ${target}`);
  }
  return violations;
}

/** Hosts named by absolute `http(s)://` URLs in a bundled JavaScript file, with the count of each. */
function jsHosts(text: string): Map<string, number> {
  const hosts = new Map<string, number>();
  for (const match of text.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
    const host = (match[1] ?? "").toLowerCase();
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  return hosts;
}

/**
 * Problems with one exception host in one JavaScript file. The file is parsed with the TypeScript parser (a root dev
 * dependency). Every occurrence of `scheme://host` must fall inside a string or template literal, and that literal must
 * not be passed to a network call, assigned to `src`, `href` or `srcset`, or named in an import or export. A string that
 * is concatenated or returned from a sub-expression is followed up to the node that uses it. Calls through a variable
 * alias are not followed.
 */
function exceptionProblems(rel: string, text: string, host: string): string[] {
  const problems: string[] = [];
  const pattern = new RegExp(`https?://${host.replace(/\./g, "\\.")}`, "gi");
  const occurrences = [...text.matchAll(pattern)].map((m) => ({ at: m.index ?? 0, len: m[0].length }));
  if (occurrences.length === 0) return problems;

  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const literals: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      literals.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const occurrence of occurrences) {
    const literal = literals.find(
      (node) => node.getStart(source) <= occurrence.at && occurrence.at + occurrence.len <= node.end,
    );
    if (!literal) {
      problems.push(`${rel}: ${host} at ${occurrence.at} is not inside a string literal`);
      continue;
    }
    const use = networkUse(literal);
    if (use !== undefined) problems.push(`${rel}: ${host} at ${occurrence.at} is used by ${use}`);
  }
  return problems;
}

/** The name of the call target, or undefined when the target is not a plain name or member. `import(...)` gives "import". */
function calleeName(expression: ts.Expression): string | undefined {
  if (expression.kind === ts.SyntaxKind.ImportKeyword) return "import";
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

/** A network use of a string literal, or undefined when the literal only sits in data or an error message. */
function networkUse(literal: ts.Node): string | undefined {
  let user: ts.Node = literal;
  for (;;) {
    const parent: ts.Node | undefined = user.parent;
    if (!parent) return undefined;
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      // The value is stored. It is a network use only when it lands on a resource-loading property.
      const target = parent.left;
      if (parent.right === user && ts.isPropertyAccessExpression(target) && NETWORK_PROPERTIES.has(target.name.text)) {
        return `.${target.name.text} assignment`;
      }
      return undefined;
    }
    if (
      ts.isBinaryExpression(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isConditionalExpression(parent) ||
      ts.isTemplateExpression(parent) ||
      ts.isTemplateSpan(parent) ||
      ts.isAsExpression(parent)
    ) {
      user = parent;
      continue;
    }
    break;
  }
  const parent = user.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return "a module specifier";
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(user as ts.Expression)) {
    const name = calleeName(parent.expression);
    if (name !== undefined && NETWORK_CALLEES.has(name)) return `${name}()`;
  }
  return undefined;
}

/** A CSS or JS length as CSS pixels, or undefined when it is not a plain length. */
function lengthPx(value: string): number | undefined {
  const match = /^(-?\d*\.?\d+)(px|rem|em)$/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  return match[2]?.toLowerCase() === "px" ? amount : amount * ROOT_FONT_PX;
}

const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/** Font-size values below the minimum in a stylesheet, or values the scanner cannot resolve. */
function cssFontViolations(file: DistFile): string[] {
  const violations: string[] = [];
  for (const decl of file.text.matchAll(/(?<![\w-])font-size\s*:\s*([^;}]+)/gi)) {
    const value = (decl[1] ?? "").trim();
    if (CSS_WIDE_KEYWORDS.has(value)) continue;
    // A clamp(min, preferred, max) is at least its minimum, so the minimum is what the scan checks.
    const clampMin = /^clamp\(\s*([^,]+),/i.exec(value);
    const px = lengthPx(clampMin?.[1] ?? value);
    if (px === undefined) violations.push(`${file.rel}: cannot resolve font-size: ${value}`);
    else if (px < MIN_FONT_PX) violations.push(`${file.rel}: font-size ${value} is ${px} px`);
  }
  // In the `font` shorthand the size is the length token before an optional "/line-height". Shorthands without a
  // length token (for example `font: inherit`) carry no size and are skipped.
  for (const decl of file.text.matchAll(/(?<![\w-])font\s*:\s*([^;}]+)/gi)) {
    const value = (decl[1] ?? "").trim();
    if (CSS_WIDE_KEYWORDS.has(value)) continue;
    const sizeToken = value.split(/\s+/).find((token) => lengthPx(token.split("/")[0] ?? "") !== undefined);
    if (sizeToken === undefined) continue;
    const px = lengthPx(sizeToken.split("/")[0] ?? "") ?? 0;
    if (px < MIN_FONT_PX) violations.push(`${file.rel}: font shorthand ${value} sets ${px} px`);
  }
  return violations;
}

/** Inline JS style font sizes below the minimum. React reads a bare number as pixels. */
function jsFontViolations(file: DistFile): string[] {
  const violations: string[] = [];
  for (const match of file.text.matchAll(/fontSize\s*:\s*("[^"]*"|'[^']*'|-?\d*\.?\d+)/g)) {
    const raw = match[1] ?? "";
    const isBareNumber = /^-?\d*\.?\d+$/.test(raw);
    const px = isBareNumber ? Number(raw) : lengthPx(raw.slice(1, -1));
    if (px === undefined) {
      violations.push(`${file.rel}: cannot resolve fontSize: ${raw}`);
    } else if (px < MIN_FONT_PX) {
      violations.push(`${file.rel}: fontSize ${raw} is ${px} px`);
    }
  }
  return violations;
}

/** A path under Dist for a local reference (`/x`, `x`, or `./x`), or undefined for an absolute URL. */
function distPathFor(reference: string): string | undefined {
  const trimmed = reference.trim();
  if (ABSOLUTE.test(trimmed)) return undefined;
  const local = trimmed.replace(/[?#].*$/, "").replace(/^\/+/, "").replace(/^\.\//, "");
  const abs = resolve(DIST, local);
  if (!abs.startsWith(DIST + sep)) return undefined;
  return abs;
}

function isExistingFile(abs: string | undefined): boolean {
  return abs !== undefined && existsSync(abs) && statSync(abs).isFile();
}

/** Social and icon metadata in `index.html` that points outside Dist, or at a missing file. */
function metadataViolations(file: DistFile): { violations: string[]; checked: string[] } {
  const violations: string[] = [];
  const checked: string[] = [];
  if (!file.rel.endsWith(".html")) return { violations, checked };
  for (const tag of file.text.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = tag[1] ?? "";
    const key = (attrValue(attrs, "property") ?? attrValue(attrs, "name") ?? "").toLowerCase();
    const content = attrValue(attrs, "content");
    if (content === undefined || !/^(og|twitter):(image|video|audio)/.test(key)) continue;
    checked.push(`${key}=${content}`);
    if (!isExistingFile(distPathFor(content))) violations.push(`${file.rel}: ${key} names ${content}, not a Dist file`);
  }
  for (const tag of file.text.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = tag[1] ?? "";
    const rel = (attrValue(attrs, "rel") ?? "").toLowerCase();
    if (!/(^|\s)(icon|apple-touch-icon|mask-icon|manifest|image_src)(\s|$)/.test(rel)) continue;
    const href = attrValue(attrs, "href") ?? "";
    checked.push(`link[rel=${rel}]=${href}`);
    if (!isExistingFile(distPathFor(href))) violations.push(`${file.rel}: link ${rel} names ${href}, not a Dist file`);
  }
  return { violations, checked };
}

const ManifestEntry = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/, "expected a lower-case SHA-256 hex digest"),
  path: z.string().min(1),
});

function parseManifest(text: string): z.infer<typeof ManifestEntry>[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = /^(\S+)\s+(.+)$/.exec(line.trimEnd());
      return ManifestEntry.parse({ hash: match?.[1] ?? "", path: match?.[2] ?? "" });
    });
}

function sha256Of(relPath: string): string {
  const abs = resolve(JARS, relPath);
  if (!abs.startsWith(JARS + sep)) throw new Error(`manifest path escapes jars/: ${relPath}`);
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

/** Files under jars/ except the manifest itself, as paths relative to jars/. */
function jarFiles(): string[] {
  return walk(JARS)
    .map((abs) => relative(JARS, abs).split(sep).join("/"))
    .filter((rel) => rel !== MANIFEST_NAME);
}

describe("Cabinet production build and Dist scan (task 10.1)", () => {
  let dist: DistFile[] = [];

  beforeAll(() => {
    runBuild();
    dist = readDist();
  }, BUILD_TIMEOUT_MS);

  it("emits index.html at the site root with root-relative assets (Requirement 17.1)", () => {
    const index = dist.find((f) => f.rel === "index.html");
    expect(index, "dist/index.html").toBeDefined();
    const srcs = [...(index?.text ?? "").matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]*)"/gi)].map(
      (m) => m[1] ?? "",
    );
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(src.startsWith("/"), src).toBe(true);
  });

  it("HTML and CSS name no absolute URL except a github.com anchor (Requirement 16.7)", () => {
    const targets = dist.filter((f) => f.rel.endsWith(".html") || f.rel.endsWith(".css"));
    expect(targets.length).toBeGreaterThan(0);
    const violations = targets.flatMap(referenceViolations);
    expect(violations).toEqual([]);
  });

  it("JavaScript names only github.com, the own site host, the Namespace_Hosts and the named exceptions (Requirements 16.7, 17.2)", () => {
    const scripts = dist.filter((f) => f.rel.endsWith(".js"));
    expect(scripts.length).toBeGreaterThan(0);
    const disallowed: string[] = [];
    for (const script of scripts) {
      for (const host of jsHosts(script.text).keys()) {
        if (!ALLOWED_JS_HOSTS.has(host) && !JS_HOST_EXCEPTIONS.includes(host)) disallowed.push(`${script.rel}: ${host}`);
      }
    }
    expect(disallowed).toEqual([]);

    const exceptionIssues = scripts.flatMap((script) =>
      JS_HOST_EXCEPTIONS.flatMap((host) => exceptionProblems(script.rel, script.text, host)),
    );
    expect(exceptionIssues).toEqual([]);

    const markupNames = dist
      .filter((f) => f.rel.endsWith(".html") || f.rel.endsWith(".css"))
      .flatMap((f) => JS_HOST_EXCEPTIONS.filter((host) => f.text.includes(host)).map((host) => `${f.rel}: ${host}`));
    expect(markupNames).toEqual([]);
  });

  it("no CSS rule or inline JS style sets a font size below 14 px (Requirement 16.9)", () => {
    const styled = dist.filter((f) => f.rel.endsWith(".css") || f.rel.endsWith(".js") || f.rel.endsWith(".html"));
    const violations = styled.flatMap((file) =>
      file.rel.endsWith(".css") ? cssFontViolations(file) : file.rel.endsWith(".js") ? jsFontViolations(file) : [],
    );
    expect(violations).toEqual([]);
  });

  it("the three font families are present as local files (Requirement 17.3)", () => {
    const css = dist.filter((f) => f.rel.endsWith(".css")).map((f) => f.text).join("\n");
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/gi)].map((m) => m[1] ?? "");
    for (const family of FAMILIES) {
      const matching = faces.filter((body) => {
        const name = /font-family\s*:\s*(?:"([^"]*)"|'([^']*)'|([^;]+))/i.exec(body);
        const value = (name?.[1] ?? name?.[2] ?? name?.[3] ?? "").trim();
        return value === family;
      });
      expect(matching.length, `@font-face for ${family}`).toBeGreaterThan(0);
      for (const body of matching) {
        const urls = cssUrls(body);
        expect(urls.length, `src for ${family}`).toBeGreaterThan(0);
        const localFiles = urls.filter((url) => isExistingFile(distPathFor(url)));
        expect(localFiles.length, `local file for ${family}`).toBeGreaterThan(0);
      }
    }
  });

  it("social and icon metadata name only Dist files (Requirement 17.2)", () => {
    const html = dist.filter((f) => f.rel.endsWith(".html"));
    expect(html.length).toBeGreaterThan(0);
    const results = html.map(metadataViolations);
    expect(results.flatMap((r) => r.violations)).toEqual([]);
  });

  it("every file under jars/ matches jars/MANIFEST.sha256 and is listed (Requirements 16.12, 17.6)", () => {
    const manifestPath = join(JARS, MANIFEST_NAME);
    const entries = parseManifest(readFileSync(manifestPath, "utf8"));
    expect(entries.length).toBeGreaterThan(0);

    const mismatches = entries
      .map((entry) => ({ path: entry.path, expected: entry.hash, actual: sha256Of(entry.path) }))
      .filter((row) => row.expected !== row.actual)
      .map((row) => `${row.path}: expected ${row.expected}, got ${row.actual}`);
    expect(mismatches).toEqual([]);

    const listed = new Set(entries.map((entry) => entry.path));
    const unlisted = jarFiles().filter((rel) => !listed.has(rel));
    expect(unlisted).toEqual([]);
  });
});
