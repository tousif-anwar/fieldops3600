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

async function signIn(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  const username = page.locator("#username");
  await username.waitFor({ state: "visible", timeout: 15000 });
  await username.fill("manager");
  await page.locator("#password").fill(demoPassword!);
  await page.locator("#kc-login").click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

test("manager opens the real maintenance agreement register", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop contract workspace");
  test.setTimeout(75000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await signIn(page);
  await page.getByRole("link", { name: "Maintenance agreements" }).click();
  await expect(
    page.getByRole("heading", { name: "Maintenance agreements", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create agreement" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agreement register" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create and activate" }),
  ).toBeVisible();
  expect(errors.filter((item) => /403|401|Uncaught|not authorized/i.test(item))).toEqual([]);
});
