import { expect, test, type Page, type Response } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  InventoryPart,
  InventoryReservation,
  JobInventory,
  PartConsumption,
  PartRequest,
  StockBalance,
  StockLocation,
} from "../src/inventory-contracts";
import type { WorkOrder } from "../src/types";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const localEnvironment = existsSync(envPath)
  ? readFileSync(envPath, "utf8")
  : "";
const demoPassword =
  process.env.DEMO_PASSWORD ??
  localEnvironment.match(/^DEMO_PASSWORD=(.+)$/m)?.[1]?.trim();

// API authorization stays in memory; failure traces would retain network headers.
test.use({
  timezoneId: "UTC",
  trace: "off",
  actionTimeout: 15000,
  navigationTimeout: 45000,
});
test.skip(
  process.env.FIELDOPS_LIVE_E2E !== "1" || !demoPassword,
  "The generated local demo identity and running business services are required.",
);

async function signIn(page: Page) {
  let authorization: string | undefined;
  page.on("request", (request) => {
    if (request.url().includes("/api/"))
      authorization = request.headers().authorization ?? authorization;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue to secure sign-in" })
    .click();
  await page.locator("#username").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill(demoPassword!);
  await page.locator("#kc-login").click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect.poll(() => authorization).toBeTruthy();
  return authorization!;
}

async function inventoryResponse(page: Page, path: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/inventory${path}`,
  );
}

async function committed<T>(response: Response): Promise<T> {
  expect(response.ok(), `Inventory command returned ${response.status()}`).toBe(
    true,
  );
  return response.json();
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

test("manager records a real stock lifecycle and recovers from unavailable stock", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180000);
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500 && response.url().includes("/api/"))
      failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  const authorization = await signIn(page);
  const headers = { Authorization: authorization };
  const suffix = randomUUID().slice(0, 8);
  const partName = `Synthetic browser filter ${suffix}`;
  const locationName = `Synthetic browser warehouse ${suffix}`;
  const sku = `BROWSER-${suffix}`.toUpperCase();
  let order: WorkOrder | undefined;
  try {
    await navigate(page, "Work orders");
    await page
      .getByRole("link", { name: "Create work order", exact: true })
      .click();
    await page
      .getByLabel("Work order title", { exact: false })
      .fill(`Synthetic inventory browser job ${suffix}`);
    await page.getByLabel("Use an unregistered customer exception").check();
    await page
      .getByLabel("Unregistered customer reason", { exact: false })
      .fill(
        "Isolated synthetic inventory browser acceptance without customer billing.",
      );
    await page
      .getByLabel("Customer name", { exact: false })
      .fill("Synthetic Browser Inventory Customer");
    await page
      .getByLabel("Service address", { exact: false })
      .fill("100 Demonstration Avenue, Test City");
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/work-orders",
    );
    await page
      .getByRole("button", { name: "Create work order", exact: true })
      .click();
    const setup = await created;
    expect(setup.status()).toBe(201);
    order = await setup.json();
    await expect(
      page.getByRole("heading", { name: order!.title, exact: true }),
    ).toBeVisible();
    await navigate(page, "Inventory");
    await expect(
      page.getByRole("heading", { name: "Inventory", exact: true }),
    ).toBeVisible();

    await page.getByText("Register a part", { exact: true }).click();
    const catalog = page
      .locator("form")
      .filter({ has: page.getByLabel("SKU", { exact: false }) });
    await catalog.getByLabel("SKU", { exact: false }).fill(sku);
    await catalog.getByLabel("Part name", { exact: false }).fill(partName);
    await catalog.getByLabel("Category", { exact: false }).fill("HVAC filter");
    await catalog
      .getByRole("textbox", { name: "Unit", exact: true })
      .fill("Each");
    await catalog
      .getByLabel("Currency (ISO code)", { exact: false })
      .fill("USD");
    await catalog.getByLabel("Unit cost", { exact: false }).fill("12.3456");
    await catalog.getByLabel("Reorder point", { exact: false }).fill("2");
    await catalog.getByLabel("Reorder quantity", { exact: false }).fill("10");
    const registration = inventoryResponse(page, "/parts");
    await catalog.getByRole("button", { name: "Register part" }).click();
    const part = await committed<InventoryPart>(await registration);
    await expect(
      page.getByText("Part registered.", { exact: true }),
    ).toBeVisible();
    await page.getByText("Register a part", { exact: true }).click();

    await page.getByText("Register a stock location", { exact: true }).click();
    const locationForm = page
      .locator("form")
      .filter({ has: page.getByLabel("Location name", { exact: false }) });
    await locationForm
      .getByLabel("Location name", { exact: false })
      .fill(locationName);
    await locationForm
      .getByLabel("Location kind", { exact: true })
      .selectOption("RegionalWarehouse");
    const locationRegistration = inventoryResponse(page, "/locations");
    await locationForm
      .getByRole("button", { name: "Register location" })
      .click();
    const location = await committed<StockLocation>(await locationRegistration);
    await expect(
      page.getByText("Stock location registered.", { exact: true }),
    ).toBeVisible();
    await page.getByText("Register a stock location", { exact: true }).click();

    await page
      .getByLabel("Work order", { exact: true })
      .first()
      .selectOption(order!.id);
    await page
      .getByLabel("Location filter", { exact: true })
      .selectOption(location.id);
    const command = page
      .locator("form")
      .filter({ has: page.getByLabel("Inventory action", { exact: true }) });
    const action = command.getByLabel("Inventory action", { exact: true });
    const quantity = command.getByLabel("Quantity", { exact: false });
    const submit = async <T>(name: string, path: string) => {
      const response = inventoryResponse(page, path);
      await command.getByRole("button", { name, exact: true }).click();
      const result = await committed<T>(await response);
      await expect(
        command.getByText("Inventory change recorded.", { exact: true }),
      ).toBeVisible();
      return result;
    };
    const stockRow = page
      .getByRole("region", { name: "Stock balances", exact: true })
      .getByRole("row")
      .filter({ hasText: sku });
    const balanceIs = async (
      onHand: number,
      reserved: number,
      available: number,
    ) => {
      await expect(stockRow).toBeVisible();
      await expect(stockRow.getByRole("cell").nth(2)).toHaveText(
        String(onHand),
      );
      await expect(stockRow.getByRole("cell").nth(3)).toHaveText(
        String(reserved),
      );
      await expect(stockRow.getByRole("cell").nth(4)).toHaveText(
        String(available),
      );
    };

    await action.selectOption("receive");
    await command.getByLabel("Part", { exact: false }).selectOption(part.id);
    await command
      .getByLabel("Stock location", { exact: false })
      .selectOption(location.id);
    await quantity.fill("8");
    await command
      .getByLabel("Reason", { exact: false })
      .fill("Synthetic supplier receipt");
    await submit<StockBalance>("Receive stock", "/stock/receive");
    await balanceIs(8, 0, 8);

    await action.selectOption("reserve");
    await quantity.fill("3");
    const reservation = await submit<InventoryReservation>(
      "Reserve for job",
      "/reservations",
    );
    await balanceIs(8, 3, 5);

    await action.selectOption("consume");
    await quantity.fill("6");
    await context.setOffline(true);
    await expect(
      command.getByRole("button", { name: "Record parts used", exact: true }),
    ).toBeDisabled();
    await expect(
      command.getByText(/Stock mutations are not queued offline/),
    ).toBeVisible();
    await context.setOffline(false);
    await expect(
      command.getByRole("button", { name: "Record parts used", exact: true }),
    ).toBeEnabled();

    const refused = inventoryResponse(page, "/consumptions");
    await command
      .getByRole("button", { name: "Record parts used", exact: true })
      .click();
    expect((await refused).status()).toBe(409);
    await expect(
      command.getByText(/Refresh inventory and review the latest stock/),
    ).toBeVisible();
    await balanceIs(8, 3, 5);
    await command
      .getByRole("button", { name: "Refresh inventory", exact: true })
      .click();
    await command
      .getByLabel("Reservation (optional)", { exact: true })
      .selectOption(reservation.id);
    await quantity.fill("2");
    const consumption = await submit<PartConsumption>(
      "Record parts used",
      "/consumptions",
    );
    await balanceIs(6, 1, 5);

    await action.selectOption("return");
    await command
      .getByLabel("Inventory record", { exact: false })
      .selectOption(consumption.id);
    await quantity.fill("1");
    await command
      .getByLabel("Reason", { exact: false })
      .fill("Synthetic unused filter returned");
    await submit<PartConsumption>(
      "Return unused parts",
      `/consumptions/${consumption.id}/return`,
    );
    await balanceIs(7, 1, 6);

    await action.selectOption("release");
    await command
      .getByLabel("Inventory record", { exact: false })
      .selectOption(reservation.id);
    await quantity.fill("1");
    await command
      .getByLabel("Reason", { exact: false })
      .fill("Synthetic unused reservation released");
    await submit<InventoryReservation>(
      "Release reservation",
      `/reservations/${reservation.id}/release`,
    );
    await balanceIs(7, 0, 7);

    await action.selectOption("request");
    await quantity.fill("2");
    await command
      .getByLabel("Request type", { exact: true })
      .selectOption("Missing");
    await command
      .getByLabel("Reason", { exact: false })
      .fill("Synthetic missing replacement filters");
    const request = await submit<PartRequest>("Request parts", "/requests");
    await page
      .getByLabel("Inventory view", { exact: true })
      .selectOption("job");
    await expect(
      page.getByText(
        `${partName} · 2 missing · Open · Synthetic missing replacement filters`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(`${partName} · 2 used · 1 returned`, { exact: true }),
    ).toBeVisible();
    await action.selectOption("close");
    await command
      .getByLabel("Inventory record", { exact: false })
      .selectOption(request.id);
    await command
      .getByLabel("Reason", { exact: false })
      .fill("Synthetic replacement request reviewed");
    await submit<PartRequest>(
      "Close parts request",
      `/requests/${request.id}/close`,
    );
    await expect(
      page.getByText(
        `${partName} · 2 missing · Closed · Synthetic missing replacement filters`,
        { exact: true },
      ),
    ).toBeVisible();

    await page
      .getByLabel("Inventory view", { exact: true })
      .selectOption("history");
    const history = page.getByRole("region", {
      name: "Inventory movement history",
      exact: true,
    });
    await expect(
      history.getByRole("row").filter({ hasText: "Consumption" }),
    ).toHaveCount(1);
    await expect(
      history
        .getByRole("row")
        .filter({ hasText: "Synthetic unused filter returned" }),
    ).toHaveCount(1);
    await expect(
      history
        .getByRole("row")
        .filter({ hasText: "Synthetic unused reservation released" }),
    ).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("inventory-movement-history.png"),
      fullPage: true,
    });
    await page
      .getByLabel("Inventory view", { exact: true })
      .selectOption("stock");
    await balanceIs(7, 0, 7);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("inventory-final-stock.png"),
      fullPage: true,
    });
    const viewport = page.viewportSize();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
    expect(failures).toEqual([]);
  } finally {
    await context.setOffline(false);
    if (order) {
      const job = await page.request.get(
        `/api/inventory/work-orders/${order.id}`,
        { headers },
      );
      expect(job.ok()).toBe(true);
      const stock: JobInventory = await job.json();
      for (const reservation of stock.reservations.filter(
        (item) => item.remaining > 0,
      )) {
        const released = await page.request.post(
          `/api/inventory/reservations/${reservation.id}/release`,
          {
            headers,
            data: {
              operationId: randomUUID(),
              quantity: reservation.remaining,
              reason: "Synthetic browser fixture cleanup",
            },
          },
        );
        expect(released.ok()).toBe(true);
      }
      for (const request of stock.requests.filter(
        (item) => item.status === "Open",
      )) {
        const closed = await page.request.post(
          `/api/inventory/requests/${request.id}/close`,
          {
            headers,
            data: {
              operationId: randomUUID(),
              reason: "Synthetic browser fixture cleanup",
            },
          },
        );
        expect(closed.ok()).toBe(true);
      }
      const current = await page.request.get(`/api/work-orders/${order.id}`, {
        headers,
      });
      expect(current.ok()).toBe(true);
      const latest: WorkOrder = await current.json();
      if (latest.status === "Created") {
        const cancelled = await page.request.put(
          `/api/work-orders/${order.id}`,
          {
            headers,
            data: {
              expectedVersion: latest.version,
              title: latest.title,
              priority: latest.priority,
              status: "Cancelled",
            },
          },
        );
        expect(cancelled.ok()).toBe(true);
      }
    }
  }
});
