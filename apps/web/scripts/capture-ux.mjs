import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = `${root}docs/ui-ux/evidence/`;
const password = readFileSync(`${root}.env`, "utf8")
  .match(/^DEMO_PASSWORD=(.+)$/m)?.[1]
  ?.trim();
if (!password) throw new Error("DEMO_PASSWORD missing from .env");
const base = process.env.WEB_BASE_URL ?? "http://localhost:5173";

const browser = await chromium.launch();

async function session(username, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: "Continue to secure sign-in" }).click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.getByRole("navigation", { name: "Main navigation" }).waitFor({ timeout: 45000 });
  await page.locator("h1.home-greeting").waitFor({ timeout: 30000 });
  return { context, page };
}

async function shot(page, name, wait = 900) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${evidence}${name}`, fullPage: false });
  console.log(`captured ${name}`);
}

// Technician Home at the two narrow breakpoints that changed with the shell.
for (const width of [320, 768]) {
  const { context, page } = await session("technician", width, width === 320 ? 812 : 1000);
  await shot(page, `after-responsive-${width}.png`);
  await context.close();
}

// Dispatch board at desktop width.
{
  const { context, page } = await session("dispatcher", 1440, 1000);
  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await page.getByRole("heading", { name: "Dispatch board", exact: true }).waitFor();
  await shot(page, "after-schedule.png", 1600);
  await context.close();
}

// Work order list and its second page, showing the pagination control.
{
  const { context, page } = await session("supervisor", 1440, 1000);
  await page.getByRole("link", { name: "Work orders", exact: true }).click();
  await page.getByRole("heading", { name: "Work orders", exact: true }).waitFor();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${evidence}after-work-orders.png` });
  console.log("captured after-work-orders.png");
  const next = page.getByRole("button", { name: "Next" });
  if (await next.isEnabled().catch(() => false)) {
    await next.click();
    await shot(page, "after-work-orders-page-2.png", 700);
  } else {
    console.log("pagination disabled: not enough rows");
  }
  await context.close();
}

// Analytics detail tab, verifying the accessible tablist still renders correctly.
{
  const { context, page } = await session("analyst", 1440, 1000);
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await page.getByRole("heading", { name: "Analytics", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Stage durations" }).click();
  await shot(page, "after-analytics-tab-duration.png", 1200);
  await context.close();
}

await browser.close();
