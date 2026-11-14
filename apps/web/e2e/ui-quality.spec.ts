import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const password =
  process.env.DEMO_PASSWORD ??
  (existsSync(envPath)
    ? readFileSync(envPath, "utf8")
        .match(/^DEMO_PASSWORD=(.+)$/m)?.[1]
        ?.trim()
    : undefined);
test.skip(
  process.env.FIELDOPS_LIVE_E2E !== "1" || !password,
  "Requires the real local PKCE identity provider and services.",
);
test.use({ reducedMotion: "reduce" });

async function signIn(page: Page, username = "dispatcher") {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password!);
  await page.locator("#kc-login").click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible({ timeout: 45000 });
}

async function navigate(page: Page, name: string) {
  const toggle = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name, exact: true })
    .click();
}

test("work-order failures announce recovery and retry returns real records", async ({
  page,
}) => {
  test.setTimeout(90000);
  // Deliberate transport fault only; recovery uses the running backend response.
  await page.route("**/api/work-orders", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        detail:
          "Synthetic outage for recovery verification. Retry the request.",
      }),
    }),
  );
  await page.goto("/work-orders");
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  await page.locator("#username").fill("dispatcher");
  await page.locator("#password").fill(password!);
  await page.locator("#kc-login").click();
  await expect(page.getByRole("alert")).toContainText("Synthetic outage", {
    timeout: 45000,
  });
  await page.unroute("**/api/work-orders");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "All work orders", exact: true }),
  ).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
});

test("loading state is announced while an actual request is pending", async ({
  page,
}) => {
  test.setTimeout(90000);
  let release: () => void = () => {};
  let requested = false;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/work-orders", async (route) => {
    requested = true;
    await blocked;
    await route.continue();
  });
  try {
    await page.goto("/work-orders");
    await page
      .getByRole("button", { name: "Continue to secure sign-in" })
      .click();
    await page.locator("#username").fill("dispatcher");
    await page.locator("#password").fill(password!);
    await page.locator("#kc-login").click();
    await expect.poll(() => requested).toBe(true);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Loading/i })
        .first(),
    ).toBeVisible({ timeout: 45000 });
  } finally {
    release();
  }
  await expect(page.locator("table tbody tr").first()).toBeVisible();
});

test("edit dialog keeps keyboard focus and returns it without changing the order", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  await navigate(page, "Work orders");
  await page
    .getByRole("button", { name: /^Open WO-/ })
    .first()
    .click();
  const trigger = page.getByRole("button", {
    name: "Edit request",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox").first()).toBeVisible();
  for (let step = 0; step < 10; step++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("mobile navigation closes with Escape and restores its trigger", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  const trigger = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await trigger.click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Close navigation", exact: true }),
  ).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Home leaves the chart bundle deferred until reporting is opened", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page, "analyst");
  const charts = () =>
    page.evaluate(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => /\/charts-[^/]+\.js/.test(entry.name)).length,
    );
  expect(await charts()).toBe(0);
  await navigate(page, "Analytics");
  await expect(
    page.getByRole("heading", { name: "Analytics", exact: true }),
  ).toBeVisible();
  await expect.poll(charts).toBeGreaterThan(0);
});
