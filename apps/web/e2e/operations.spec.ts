import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WorkOrder, Workflow } from "../src/types";

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
  let authorization: string | undefined;
  page.on("request", (request) => {
    if (request.url().includes("/api/"))
      authorization = request.headers().authorization ?? authorization;
  });
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
  await expect.poll(() => authorization).toBeTruthy();
  return authorization!;
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
  const advanceBusinessDay = () => {
    next.setUTCDate(next.getUTCDate() + 1);
    while ([0, 6].includes(next.getUTCDay()))
      next.setUTCDate(next.getUTCDate() + 1);
  };
  while ([0, 6].includes(next.getUTCDay())) advanceBusinessDay();
  // 15:00 UTC is 10:00 in the synthetic team's America/New_York zone in November.
  next.setUTCHours(15, 0, 0, 0);
  const appointment = page.getByLabel("Appointment start (your local time)", {
    exact: false,
  });
  // Pick the first business-day slot with capacity. A fixed slot becomes
  // unavailable after repeated local runs have booked every qualified technician.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await appointment.fill(next.toISOString().slice(0, 16));
    await page
      .getByRole("button", { name: "Find qualified technicians" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Recommended technicians" }),
    ).toBeVisible();
    const hasRecommendation = await page
      .getByRole("radio")
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (hasRecommendation) break;
    await expect(page.getByText("No feasible assignments")).toBeVisible();
    advanceBusinessDay();
  }
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

test("supervisor reviews completed dropdown history and replays evidence without operational mutations", async ({
  page,
}) => {
  test.setTimeout(90000);
  const authorization = await signIn(page, "supervisor");
  const headers = { Authorization: authorization };
  const workflowsResponse = await page.request.get("/api/workflows", {
    headers,
  });
  expect(workflowsResponse.ok()).toBe(true);
  const workflows: Workflow[] = await workflowsResponse.json();
  const completed = workflows.find(
    (workflow) => workflow.status === "Completed",
  );
  test.skip(
    !completed,
    "Run the real API demonstration first to create a completed eight-stage workflow.",
  );
  const ordersResponse = await page.request.get("/api/work-orders", {
    headers,
  });
  expect(ordersResponse.ok()).toBe(true);
  const orders: WorkOrder[] = await ordersResponse.json();
  const order = orders.find((item) => item.id === completed!.workOrderId)!;
  expect(order).toBeTruthy();
  if ((page.viewportSize()?.width ?? 1440) <= 760)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "My workflow", exact: true }).click();
  const card = page.locator(".job-card").filter({
    has: page.getByRole("heading", { name: order.title, exact: true }),
  });
  await card
    .getByRole("button", { name: "Review service", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Service complete", exact: true }),
  ).toBeVisible();
  await page.locator(".workflow-stepper li").nth(2).getByRole("button").click();
  await expect(
    page.getByRole("heading", { name: "3. Initial Inspection", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox").first()).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Submit & continue", exact: true }),
  ).not.toBeVisible();
  const commands: string[] = [];
  page.on("request", (request) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      request.url().includes("/api/")
    )
      commands.push(request.url());
  });
  await page
    .getByRole("button", { name: "View operational replay", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Event timeline", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".playback-count")).toHaveText(/Event\s+1\s+of/);
  await page.getByRole("button", { name: "Next event", exact: true }).click();
  await expect(page.locator(".playback-count")).toHaveText(/Event\s+2\s+of/);
  await page
    .getByRole("button", { name: "Previous event", exact: true })
    .click();
  await expect(page.locator(".playback-count")).toHaveText(/Event\s+1\s+of/);
  const breach = page.getByRole("button", {
    name: "First breach",
    exact: true,
  });
  if (await breach.isEnabled()) await breach.click();
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/);
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Incident PDF", exact: true }).click();
  expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/);
  expect(commands).toEqual([]);
});
