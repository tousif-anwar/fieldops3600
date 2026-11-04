import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const environmentPath = path.join(root, ".env");
const environment = existsSync(environmentPath)
  ? readFileSync(environmentPath, "utf8")
  : "";
const password =
  process.env.DEMO_PASSWORD ??
  environment.match(/^DEMO_PASSWORD=(.+)$/m)?.[1]?.trim();
if (!password)
  throw new Error(
    "Generate local demo credentials before capturing authenticated screenshots.",
  );
const base = process.env.WEB_BASE_URL ?? "http://localhost:5173";
const output = path.join(
  fileURLToPath(new URL("../", import.meta.url)),
  "artifacts",
);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1512, height: 1040 },
  timezoneId: "America/New_York",
});
const page = await context.newPage();
let authorization;
page.on("request", (request) => {
  if (request.url().startsWith(base + "/api/"))
    authorization = request.headers().authorization ?? authorization;
});
const capture = async (name) => {
  // Allow the actual charts and layout to settle before recording their pixels.
  await page.waitForTimeout(1800);
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: true,
  });
  console.log(`Captured ${name}.png`);
};
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  await capture("login-desktop");
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  await page.locator("#username").fill("supervisor");
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .waitFor({ timeout: 30000 });
  await page.getByRole("heading", { name: "Live operations" }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".loading-state").length === 0,
    undefined,
    { timeout: 20000 },
  );
  await capture("operations-overview");
  await page.getByRole("link", { name: "Supervisor", exact: true }).click();
  await page
    .getByRole("heading", { name: "Jobs requiring attention" })
    .waitFor();
  await capture("supervisor-dashboard");
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await page.getByText("Total work orders", { exact: true }).waitFor();
  await capture("analytics-dashboard");
  if (authorization) {
    const headers = { Authorization: authorization };
    const ordersResponse = await page.request.get(base + "/api/work-orders", {
      headers,
    });
    const orders = ordersResponse.ok() ? await ordersResponse.json() : [];
    let best;
    for (const order of orders.slice(0, 25)) {
      const response = await page.request.get(
        `${base}/api/replay/${order.id}`,
        { headers },
      );
      if (!response.ok()) continue;
      const replay = await response.json();
      const score = replay.events.length + 100 * replay.summary.breachCount;
      if (!best || score > best.score) best = { order, replay, score };
    }
    if (best?.replay.events.length) {
      await page.getByRole("link", { name: /Operational replay/ }).click();
      await page
        .getByRole("combobox", { name: "Select work order for investigation" })
        .selectOption(best.order.id);
      await page
        .getByRole("button", { name: "Investigate", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Event timeline", exact: true })
        .waitFor();
      const breach = page.getByRole("button", {
        name: "First breach",
        exact: true,
      });
      if (await breach.isEnabled()) await breach.click();
      await capture("operational-replay");
    }
    const workflowsResponse = await page.request.get(base + "/api/workflows", {
      headers,
    });
    const workflows = workflowsResponse.ok()
      ? await workflowsResponse.json()
      : [];
    const workflow =
      workflows.find((item) => item.status !== "Completed") ?? workflows[0];
    if (workflow) {
      // A client-side navigation preserves the in-memory OIDC session.
      await page
        .getByRole("link", { name: "My workflow", exact: true })
        .click();
      const selected = page.locator(
        `.job-card[data-work-order-id="${workflow.workOrderId}"]`,
      );
      await selected.waitFor({ state: "visible", timeout: 20000 });
      await selected.getByRole("button").click();
      await page.locator(".workflow-stepper").waitFor();
      await capture("guided-service-workflow");
    }
  }
} finally {
  await browser.close();
}
