import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Asset, AssetChange } from "../src/asset-contracts";
import type {
  Customer,
  CustomerChange,
  Page as ResultPage,
} from "../src/customer-contracts";
import type { WorkOrder } from "../src/types";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const localEnvironment = existsSync(envPath)
  ? readFileSync(envPath, "utf8")
  : "";
const demoPassword =
  process.env.DEMO_PASSWORD ??
  localEnvironment.match(/^DEMO_PASSWORD=(.+)$/m)?.[1]?.trim();
test.skip(
  process.env.FIELDOPS_LIVE_E2E !== "1" || !demoPassword,
  "Requires running services and synthetic seed-demo-data.py registry fixtures.",
);

async function signIn(page: Page) {
  let authorization: string | undefined;
  const commands: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) {
      authorization = request.headers().authorization ?? authorization;
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
        commands.push(request.url());
    }
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  await page.locator("#username").fill("supervisor");
  await page.locator("#password").fill(demoPassword!);
  await page.locator("#kc-login").click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible({
    timeout: 30000,
  });
  await expect.poll(() => authorization).toBeTruthy();
  return { headers: { Authorization: authorization! }, commands };
}

async function navigate(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name, exact: true })
    .click();
}

function panel(page: Page, title: string) {
  return page
    .locator("section.panel")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

async function get<T>(
  page: Page,
  path: string,
  headers: { Authorization: string },
): Promise<T> {
  const response = await page.request.get(path, { headers });
  expect(response.ok(), `Authorized live read ${path}`).toBe(true);
  return response.json();
}

test("supervisor reads paginated customers, current details and linked service/change history", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { headers, commands } = await signIn(page);
  const first = await get<ResultPage<Customer>>(
    page,
    "/api/customers?status=&sort=name&page=1&pageSize=10",
    headers,
  );
  expect(
    first.total,
    "Seed at least eleven synthetic customers to exercise pagination",
  ).toBeGreaterThan(10);
  const second = await get<ResultPage<Customer>>(
    page,
    "/api/customers?status=&sort=name&page=2&pageSize=10",
    headers,
  );
  const orders = await get<WorkOrder[]>(page, "/api/work-orders", headers);
  const linked = orders.find((order) => order.customerId);
  expect(linked, "Seed a customer-linked work order").toBeTruthy();
  const customer = await get<Customer>(
    page,
    `/api/customers/${linked!.customerId}`,
    headers,
  );
  const history = await get<CustomerChange[]>(
    page,
    `/api/customers/${customer.id}/history`,
    headers,
  );
  const services = await get<ResultPage<WorkOrder>>(
    page,
    `/api/work-orders/by-customer/${customer.id}?page=1&pageSize=10`,
    headers,
  );
  expect(services.total).toBeGreaterThan(0);
  expect(history.length).toBeGreaterThan(0);

  await navigate(page, "Customers");
  await page.getByLabel("Customer status", { exact: true }).selectOption("");
  await expect(
    page.getByText(`${first.total} matching customers`, { exact: true }),
  ).toBeVisible();
  const registry = panel(page, "Customer registry");
  await expect(registry.locator("tbody tr")).toHaveCount(first.items.length);
  await expect(
    registry.locator(`a[href='/customers/${first.items[0].id}']`),
  ).toBeVisible();
  await registry.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    registry.getByText(`Page 2 of ${Math.ceil(first.total / 10)}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    registry.locator(`a[href='/customers/${second.items[0].id}']`),
  ).toBeVisible();
  await registry.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(
    registry.locator(`a[href='/customers/${first.items[0].id}']`),
  ).toBeVisible();
  await page
    .getByLabel("Search customers", { exact: true })
    .fill(customer.displayName);
  await registry.locator(`a[href='/customers/${customer.id}']`).click();
  await expect(
    page.getByRole("heading", { name: customer.displayName, exact: true }),
  ).toBeVisible();
  for (const location of customer.locations) {
    await expect(
      panel(page, "Service locations").getByRole("heading", {
        name: location.name,
        exact: true,
      }),
    ).toBeVisible();
  }
  for (const contact of customer.contacts) {
    await expect(
      panel(page, "Contacts").getByRole("heading", {
        name: contact.fullName + (contact.isPrimary ? " (primary)" : ""),
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(panel(page, "Change history").locator("tbody tr")).toHaveCount(
    history.length,
  );
  await expect(
    panel(page, "Service history").getByRole("link", {
      name: services.items[0].number,
      exact: true,
    }),
  ).toBeVisible();
  await panel(page, "Service history")
    .getByRole("link", { name: services.items[0].number, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: services.items[0].title, exact: true }),
  ).toBeVisible();
  expect(
    commands,
    "Registry browsing must not issue operational mutations",
  ).toEqual([]);
});

test("supervisor reads paginated equipment, installation details and explicitly linked service history", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { headers, commands } = await signIn(page);
  const first = await get<ResultPage<Asset>>(
    page,
    "/api/assets?status=&sort=name&page=1&pageSize=10",
    headers,
  );
  expect(
    first.total,
    "Seed at least eleven synthetic assets to exercise pagination",
  ).toBeGreaterThan(10);
  const second = await get<ResultPage<Asset>>(
    page,
    "/api/assets?status=&sort=name&page=2&pageSize=10",
    headers,
  );
  const orders = await get<WorkOrder[]>(page, "/api/work-orders", headers);
  const linked = orders.find((order) => order.assetId);
  expect(linked, "Seed an explicitly asset-linked work order").toBeTruthy();
  const asset = await get<Asset>(
    page,
    `/api/assets/${linked!.assetId}`,
    headers,
  );
  const history = await get<AssetChange[]>(
    page,
    `/api/assets/${asset.id}/history`,
    headers,
  );
  const services = await get<ResultPage<WorkOrder>>(
    page,
    `/api/work-orders/by-asset/${asset.id}?pageSize=50`,
    headers,
  );
  expect(services.total).toBeGreaterThan(0);
  expect(history.length).toBeGreaterThan(0);
  expect(asset.locationHistory.length).toBeGreaterThan(0);

  await navigate(page, "Assets");
  await page.getByLabel("Asset status", { exact: true }).selectOption("");
  await expect(
    page.getByText(`${first.total} matching assets`, { exact: true }),
  ).toBeVisible();
  const registry = panel(page, "Registered equipment");
  await expect(registry.locator("tbody tr")).toHaveCount(first.items.length);
  await expect(
    registry.locator(`a[href='/assets/${first.items[0].id}']`),
  ).toBeVisible();
  await registry.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    registry.getByText(`Page 2 of ${Math.ceil(first.total / 10)}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    registry.locator(`a[href='/assets/${second.items[0].id}']`),
  ).toBeVisible();
  await page
    .getByLabel("Search assets", { exact: true })
    .fill(asset.serialNumber);
  await registry.locator(`a[href='/assets/${asset.id}']`).click();
  await expect(
    page.getByRole("heading", { name: asset.name, exact: true }),
  ).toBeVisible();
  await expect(
    panel(page, "Equipment").getByText(`Serial number: ${asset.serialNumber}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel(page, "Installation history").locator("tbody tr"),
  ).toHaveCount(asset.locationHistory.length);
  await expect(panel(page, "Change history").locator("tbody tr")).toHaveCount(
    history.length,
  );
  await expect(
    panel(page, "Equipment service history").getByRole("link", {
      name: services.items[0].number,
      exact: true,
    }),
  ).toBeVisible();
  await panel(page, "Equipment service history")
    .getByRole("link", { name: services.items[0].number, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: services.items[0].title, exact: true }),
  ).toBeVisible();
  expect(
    commands,
    "Equipment browsing must not issue operational mutations",
  ).toEqual([]);
});

test("supervisor registry insights match the actual persisted reporting responses", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { commands } = await signIn(page);
  const customerResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/reports/customers" &&
      response.request().method() === "GET",
  );
  const assetResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/reports/assets" &&
      response.request().method() === "GET",
  );
  await navigate(page, "Customer and asset insights");
  const [customerHttp, assetHttp] = await Promise.all([
    customerResponse,
    assetResponse,
  ]);
  expect(customerHttp.ok()).toBe(true);
  expect(assetHttp.ok()).toBe(true);
  const customers = await customerHttp.json();
  const assets = await assetHttp.json();
  await expect(
    page.getByRole("heading", {
      name: "Customer and asset insights",
      exact: true,
    }),
  ).toBeVisible();
  for (const [label, value] of [
    ["Registered customers", customers.registeredCustomers],
    ["Contacts", customers.contactCount],
    ["Contacts with email consent", customers.emailConsentCount],
    ["Linked work orders", customers.linkedWorkOrders],
    ["Registered assets", assets.registeredAssets],
    ["Explicitly linked work orders", assets.linkedWorkOrders],
    ["Warranties expiring within 90 days", assets.warrantyExpiring90Days],
  ] as [string, number][]) {
    const row = page
      .locator("dl.detail-list > div")
      .filter({ has: page.locator("dt").getByText(label, { exact: true }) });
    await expect(row.locator("dd")).toHaveText(value.toLocaleString());
  }
  await expect(
    page.getByText(/Customer-only orders are excluded/),
  ).toBeVisible();
  expect(
    commands,
    "Reporting reads must not issue operational mutations",
  ).toEqual([]);
});
