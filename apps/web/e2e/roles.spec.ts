import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const localEnvironment = existsSync(envPath)
  ? readFileSync(envPath, "utf8")
  : "";
const demoPassword =
  process.env.DEMO_PASSWORD ??
  localEnvironment.match(/^DEMO_PASSWORD=(.+)$/m)?.[1]?.trim();

test.use({ timezoneId: "UTC" });
test.skip(
  process.env.FIELDOPS_LIVE_E2E !== "1" || !demoPassword,
  "The local generated demo credentials and running services are required.",
);

async function completeKeycloak(page: Page, username: string) {
  const usernameField = page.locator("#username");
  if (
    await usernameField
      .waitFor({ state: "visible", timeout: 6000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await usernameField.fill(username);
    await page.locator("#password").fill(demoPassword!);
    await page.locator("#kc-login").click();
  }
}

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  await completeKeycloak(page, username);
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible({ timeout: 45000 });
  await expect(page.locator("h1.home-greeting")).toBeVisible({
    timeout: 30000,
  });
}

const roles = [
  {
    username: "technician",
    context: "Field technician",
    panel: "Needs attention",
    navigation: ["Home", "Work orders", "Schedule", "My work"],
    hidden: ["Analytics", "Administration"],
  },
  {
    username: "dispatcher",
    context: "Dispatch",
    panel: "Needs attention",
    navigation: ["Home", "Work orders", "Schedule", "Operations overview"],
    hidden: ["My work", "Administration", "SLA monitoring"],
  },
  {
    username: "supervisor",
    context: "Supervisor",
    panel: "Needs attention",
    navigation: [
      "Home",
      "Work orders",
      "SLA monitoring",
      "Operational replay",
      "Analytics",
    ],
    hidden: ["Administration", "My work"],
  },
  {
    username: "manager",
    context: "Operations manager",
    panel: "Needs attention",
    navigation: [
      "Home",
      "Work orders",
      "SLA monitoring",
      "Analytics",
      "Operations overview",
    ],
    hidden: ["Administration", "My work"],
  },
  {
    username: "analyst",
    context: "Analyst",
    panel: "Start an analysis",
    navigation: ["Home", "Analytics", "All workspaces"],
    hidden: ["Work orders", "SLA monitoring", "Administration"],
  },
  {
    username: "administrator",
    context: "Administrator",
    panel: "Administration areas",
    navigation: ["Home", "Work orders", "Operational replay", "Administration"],
    hidden: ["My work", "Schedule", "SLA monitoring"],
  },
] as const;

for (const role of roles) {
  test(`${role.username} lands on a role-aware Home with authorized navigation`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop role matrix");
    test.setTimeout(75000);
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
      if (message.type() === "error" && /403|same key|Uncaught/i.test(message.text())) {
        // Preserve the exact message for the assertion below.
        problems.push(message.text());
      }
    });
    await signIn(page, role.username);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".home-context")).toContainText(role.context);
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Home");
    await expect(
      page.getByRole("heading", { name: role.panel, exact: true }),
    ).toBeVisible();
    const navigation = page.getByRole("navigation", {
      name: "Main navigation",
    });
    for (const item of role.navigation) {
      await expect(navigation.getByRole("link", { name: item, exact: true })).toBeVisible();
    }
    for (const item of role.hidden) {
      await expect(
        navigation.getByRole("link", { name: item, exact: true }),
      ).toHaveCount(0);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      problems.filter((problem) =>
        /403|same key|Uncaught|not authorized/i.test(problem),
      ),
    ).toEqual([]);
  });
}

test("a protected deep link survives reauthentication and retains its query", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop deep-link coverage");
  test.setTimeout(90000);
  await signIn(page, "supervisor");
  await page.goto("/work-orders?status=Created");
  await expect(
    page.getByRole("button", { name: "Continue to secure sign-in" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  await completeKeycloak(page, "supervisor");
  await expect(page.getByRole("heading", { name: "Work orders" })).toBeVisible({
    timeout: 45000,
  });
  await expect(page).toHaveURL(/\/work-orders\?status=Created$/);
  await expect(page.getByLabel("Filter status")).toHaveValue("Created");
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toContainText("Work orders");
});

test("an unauthorized deep link is denied without exposing administration", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop authorization coverage");
  test.setTimeout(75000);
  await page.goto("/administration");
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  await completeKeycloak(page, "analyst");
  await expect(page.getByRole("alert")).toContainText(
    "does not have permission",
    { timeout: 45000 },
  );
  await expect(page.getByRole("heading", { name: "Administration" })).toHaveCount(0);
});

test("sign-out returns to the secure entry screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop sign-out coverage");
  test.setTimeout(75000);
  await signIn(page, "technician");
  await page.getByLabel(/Account menu for/i).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Continue to secure sign-in" }),
  ).toBeVisible({ timeout: 45000 });
});

test("Home reflows across supported widths and restores mobile navigation", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop responsive coverage");
  test.setTimeout(90000);
  await signIn(page, "technician");
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width <= 760 ? 812 : 1000 });
    await page.waitForTimeout(150);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      `horizontal overflow at ${width}px`,
    ).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).first().click();
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("keyboard order reaches the skip link and account menu", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop keyboard coverage");
  test.setTimeout(75000);
  await signIn(page, "dispatcher");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.getByLabel(/Account menu for/i).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
});
