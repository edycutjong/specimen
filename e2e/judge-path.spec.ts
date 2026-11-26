import { expect, test, type Page } from "@playwright/test";

// The judge path, end to end, on the built site: the cabinet at /, the landing at /landing/ and the deck at /deck/
// each replay the committed jars in the tab. The counts are the ones in evidence/bench/detect.md.

/** Collects every request to a host other than the one under test, and every page error or console error. */
function watch(page: Page) {
  const own = new URL(test.info().project.use.baseURL ?? "http://localhost").host;
  const thirdParty: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.host !== own) thirdParty.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { thirdParty, errors };
}

const verdict = (page: Page) => page.locator('section[aria-label="Verdict"] [role="status"]');

async function replay(page: Page, version: "v1" | "v2" | "v2.1") {
  await page.getByRole("radio", { name: version, exact: true }).click();
  await expect(page.getByRole("radio", { name: version, exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: /^Replay/ }).click();
}

test.describe("cabinet (/)", () => {
  test("replays the ten jars against v2 on load: HOLD, 5 preserved · 4 rattled · 1 cracked", async ({ page }) => {
    const seen = watch(page);
    await page.goto("/");
    await expect(page.locator(".jar")).toHaveCount(10);
    await expect(page.getByRole("radio", { name: "v2", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(verdict(page)).toContainText("HOLD", { timeout: 20_000 });
    await expect(verdict(page)).toContainText("5 preserved · 4 rattled · 1 cracked");
    expect(seen.thirdParty).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test("v2.1, the Kiro fix, replays SHIP: 10 preserved · 0 rattled · 0 cracked", async ({ page }) => {
    const seen = watch(page);
    await page.goto("/");
    await expect(verdict(page)).toContainText("HOLD", { timeout: 20_000 });
    await replay(page, "v2.1");
    await expect(verdict(page)).toContainText("SHIP", { timeout: 20_000 });
    await expect(verdict(page)).toContainText("10 preserved · 0 rattled · 0 cracked");
    expect(seen.thirdParty).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test("v1, the server the jars were recorded against, replays SHIP", async ({ page }) => {
    await page.goto("/");
    await expect(verdict(page)).toContainText("HOLD", { timeout: 20_000 });
    await replay(page, "v1");
    await expect(verdict(page)).toContainText("SHIP", { timeout: 20_000 });
    await expect(verdict(page)).toContainText("10 preserved · 0 rattled · 0 cracked");
  });

  test("the server switch is a keyboard radio group", async ({ page }) => {
    await page.goto("/");
    await expect(verdict(page)).toContainText("HOLD", { timeout: 20_000 });
    await page.getByRole("radio", { name: "v2", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "v2.1", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "v2.1", exact: true })).toBeFocused();
  });
});

test.describe("landing (/landing/)", () => {
  test("the hero shelf replays v2 live in the tab, with no third-party request", async ({ page }) => {
    const seen = watch(page);
    await page.goto("/landing/");
    await expect(page.locator("h1")).toContainText("The jars remember what your server used to say.");
    await expect(page.getByText(/HOLD v2: 5 preserved, 4 rattled, 1 cracked\. Replayed live in this tab/)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('a[href="/deck/"]').first()).toBeVisible();
    expect(seen.thirdParty).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});

test.describe("deck (/deck/)", () => {
  test("opens on slide 1 of 10 and advances with the keyboard", async ({ page }) => {
    const seen = watch(page);
    await page.goto("/deck/");
    const count = page.locator(".count[aria-live]");
    await expect(count).toHaveText("01 / 10");
    await page.keyboard.press("ArrowRight");
    await expect(count).toHaveText("02 / 10");
    expect(seen.thirdParty).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});

test.describe("static files the pages load", () => {
  test("/static/replay.js and /static/repo.json are served", async ({ request }) => {
    const js = await request.get("/static/replay.js");
    expect(js.status()).toBe(200);
    expect(await js.text()).toContain("runReplay");
    const repo = await request.get("/static/repo.json");
    expect(repo.status()).toBe(200);
    expect(typeof (await repo.json()).public).toBe("boolean");
  });
});

test.describe("phone widths", () => {
  for (const path of ["/", "/landing/", "/deck/"]) {
    for (const width of [320, 375]) {
      test(`${path} has no horizontal page scroll at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }
});
