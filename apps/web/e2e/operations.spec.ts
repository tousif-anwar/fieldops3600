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
  "The local generated demo credentials and running Compose services are required.",
);

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(demoPassword!);
  await page.locator("#kc-login").click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible({ timeout: 30000 });
}

test("dispatcher creates a real request and confirms a feasible booking through PKCE", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page, "dispatcher");
  await page.getByRole("button", { name: "Create work order" }).first().click();
  const title = `Synthetic E2E cooling inspection ${Date.now()}`;
  await page.getByLabel("Work order title", { exact: false }).fill(title);
  await page
    .getByLabel("Customer name", { exact: false })
    .fill("Synthetic E2E Customer");
  await page
    .getByLabel("Service address", { exact: false })
    .fill("100 Example Avenue, Test City");
  await page
    .getByRole("button", { name: "Create work order", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page
    .getByRole("button", { name: "Schedule service", exact: true })
    .click();
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + 1);
  while ([0, 6].includes(next.getUTCDay()))
    next.setUTCDate(next.getUTCDate() + 1);
    // 15:00 UTC is 10:00 in the synthetic team's America/New_York zone in November.
    next.setUTCHours(15, 0, 0, 0);
  await page
    .getByLabel("Appointment start (your local time)", { exact: false })
    .fill(next.toISOString().slice(0, 16));
  await page
    .getByRole("button", { name: "Find qualified technicians" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recommended technicians" }),
  ).toBeVisible();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(
    page.getByText("Booking confirmed. The technician is now assigned."),
  ).toBeVisible();
});

test("supervisor sees role-scoped analytics and read-only replay controls", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signIn(page, "supervisor");
  if ((page.viewportSize()?.width ?? 1440) <= 760)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "See the patterns. Improve the next day.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Total work orders", { exact: true }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) <= 760)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: /Operational replay/ }).click();
  await expect(page.getByText("Read-only historical playback")).toBeVisible();
});
