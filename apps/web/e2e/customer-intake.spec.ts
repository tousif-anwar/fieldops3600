import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  PortalAccount,
  PortalWorkOrder,
  ServiceRequest,
} from "../src/service-request-contracts";
import type { AssignmentOffer } from "../src/assignment-contracts";

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
  "A running local stack and seed-customer-portal.py identities are required.",
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
  ).toBeVisible({ timeout: 45000 });
  await expect.poll(() => authorization).toBeTruthy();
  return authorization!;
}

test("customer intake is isolated, qualified by dispatch, and offered without a false appointment confirmation", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Desktop end-to-end intake lifecycle",
  );
  test.setTimeout(180000);
  const customerContext = await browser.newContext({ baseURL });
  const dispatcherContext = await browser.newContext({
    baseURL,
    timezoneId: "UTC",
  });
  const otherContext = await browser.newContext({ baseURL });
  const customer = await customerContext.newPage();
  const dispatcher = await dispatcherContext.newPage();
  const other = await otherContext.newPage();
  let createdOffer: AssignmentOffer | null = null;
  let dispatcherAuthorization = "";
  try {
    const customerAuthorization = await signIn(customer, "customer");
    await expect(customer).toHaveURL(/\/portal$/);
    const accountResponse = await customer.request.get(
      "/api/customer-portal/account",
      { headers: { Authorization: customerAuthorization } },
    );
    expect(accountResponse.ok()).toBe(true);
    const account: PortalAccount = await accountResponse.json();
    const location = account.locations.find((item) => item.status === "Active");
    expect(location).toBeTruthy();
    const navigation = customer.getByRole("navigation", {
      name: "Main navigation",
    });
    await expect(
      navigation.getByRole("link", { name: "Customer portal", exact: true }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "Work orders", exact: true }),
    ).toHaveCount(0);
    await expect(customer.getByRole("search")).toHaveCount(0);
    const title = `Synthetic customer intake ${Date.now()}`;
    await customer
      .getByLabel("Service location", { exact: false })
      .selectOption(location!.id);
    await customer.getByLabel("Request title", { exact: false }).fill(title);
    await customer
      .getByLabel("Describe the problem", { exact: false })
      .fill(
        "Synthetic end-to-end fixture: the office HVAC unit is not cooling and needs a diagnostic visit.",
      );
    const submitted = customer.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/service-requests"),
    );
    await customer
      .getByRole("button", { name: "Submit service request" })
      .click();
    const submittedResponse = await submitted;
    expect(submittedResponse.status()).toBe(201);
    const request: ServiceRequest = await submittedResponse.json();
    expect(request.status).toBe("Submitted");
    expect(request.workOrderId).toBeNull();
    await expect(
      customer.getByText(
        "Service request received for review. Your appointment will appear here once scheduling is confirmed.",
      ),
    ).toBeVisible();

    const otherAuthorization = await signIn(other, "customer-other");
    const otherRequests = await other.request.get("/api/service-requests", {
      headers: { Authorization: otherAuthorization },
    });
    expect(otherRequests.ok()).toBe(true);
    const isolatedRequests: ServiceRequest[] = await otherRequests.json();
    expect(isolatedRequests.some((item) => item.id === request.id)).toBe(false);

    dispatcherAuthorization = await signIn(dispatcher, "dispatcher");
    await dispatcher
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Service requests", exact: true })
      .click();
    const requestCard = dispatcher.locator(".portal-record").filter({
      has: dispatcher.getByRole("heading", { name: title, exact: true }),
    });
    await requestCard.getByRole("button", { name: "Review request" }).click();
    await dispatcher
      .getByLabel("Decision reason", { exact: false })
      .fill("Synthetic fixture qualified for an HVAC diagnostic visit.");
    const qualified = dispatcher.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/service-requests/${request.id}/qualify`),
    );
    await dispatcher
      .getByRole("button", { name: "Create work order", exact: true })
      .click();
    const qualifiedResponse = await qualified;
    expect(qualifiedResponse.ok()).toBe(true);
    const qualifiedRequest: ServiceRequest = await qualifiedResponse.json();
    expect(qualifiedRequest.workOrderId).toBeTruthy();
    await dispatcher.getByLabel("Request status").selectOption("Qualified");
    await requestCard.getByRole("link", { name: "View work order" }).click();
    await expect(
      dispatcher.getByRole("heading", { name: title, level: 1, exact: true }),
    ).toBeVisible();
    await expect(
      dispatcher.getByText(request.description, {
        exact: true,
        selector: "dd",
      }),
    ).toBeVisible();
    await dispatcher
      .getByRole("button", { name: "Schedule service", exact: true })
      .click();
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + 7);
    next.setUTCHours(15, 0, 0, 0);
    const nextWeekday = () => {
      next.setUTCDate(next.getUTCDate() + 1);
      while ([0, 6].includes(next.getUTCDay()))
        next.setUTCDate(next.getUTCDate() + 1);
    };
    while ([0, 6].includes(next.getUTCDay())) nextWeekday();
    for (let attempt = 0; attempt < 7; attempt++) {
      await dispatcher
        .getByLabel("Appointment start (your local time)", { exact: false })
        .fill(next.toISOString().slice(0, 16));
      await dispatcher
        .getByRole("button", { name: "Find qualified technicians" })
        .click();
      await expect(
        dispatcher.getByRole("heading", { name: "Recommended technicians" }),
      ).toBeVisible();
      if (await dispatcher.getByRole("radio").first().isVisible()) break;
      nextWeekday();
    }
    await dispatcher.getByRole("radio").first().check();
    await dispatcher.getByLabel("Assignment method").selectOption("offer");
    const offered = dispatcher.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/assignment-offers"),
    );
    await dispatcher
      .getByRole("button", { name: "Send assignment offer" })
      .click();
    const offeredResponse = await offered;
    expect(offeredResponse.status()).toBe(201);
    createdOffer = await offeredResponse.json();
    expect(createdOffer?.status).toBe("Pending");
    expect(createdOffer?.bookingId).toBeNull();
    await expect(
      dispatcher.getByText(
        "Offer sent. Awaiting technician acceptance; no booking is confirmed yet.",
      ),
    ).toBeVisible();
    await customer
      .getByRole("button", { name: "Refresh your service" })
      .click();
    const ownRequest = customer.locator(".portal-record").filter({
      has: customer.getByRole("heading", { name: title, exact: true }),
    });
    await expect(
      ownRequest.getByText("Qualified", { exact: true }),
    ).toBeVisible();
    const appointments = await customer.request.get(
      "/api/customer-portal/appointments",
      { headers: { Authorization: customerAuthorization } },
    );
    expect(appointments.ok()).toBe(true);
    expect(
      (await appointments.json()).some(
        (item: { workOrderId: string }) =>
          item.workOrderId === qualifiedRequest.workOrderId,
      ),
    ).toBe(false);
    const blockedOrder = await other.request.get(
      `/api/work-orders/${qualifiedRequest.workOrderId}`,
      { headers: { Authorization: otherAuthorization } },
    );
    expect(blockedOrder.status()).toBe(403);
    for (const width of [375, 1024, 1440]) {
      await customer.setViewportSize({ width, height: 900 });
      expect(
        await customer.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    }
  } finally {
    if (createdOffer && dispatcherAuthorization) {
      const revoked = await dispatcher.request.post(
        `/api/assignment-offers/${createdOffer.id}/revoke`,
        {
          headers: { Authorization: dispatcherAuthorization },
          data: {
            expectedVersion: createdOffer.version,
            idempotencyKey: crypto.randomUUID(),
            reason: "Synthetic browser verification complete; release offer.",
          },
        },
      );
      expect(revoked.ok()).toBe(true);
    }
    await Promise.all([
      customerContext.close(),
      dispatcherContext.close(),
      otherContext.close(),
    ]);
  }
});

test("customer reviews the stored completion report and keeps portal navigation accessible after closing", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Desktop service report and dialog lifecycle",
  );
  test.setTimeout(60000);
  const authorization = await signIn(page, "customer");
  const ordersResponse = await page.request.get(
    "/api/customer-portal/work-orders",
    { headers: { Authorization: authorization } },
  );
  expect(ordersResponse.ok()).toBe(true);
  const orders: PortalWorkOrder[] = await ordersResponse.json();
  const completed = orders.find((order) => order.status === "Completed");
  expect(
    completed,
    "Run the real customer lifecycle verification to create a completed service record.",
  ).toBeTruthy();
  const record = page
    .locator(".portal-record")
    .filter({ has: page.getByText(completed!.number, { exact: true }) });
  await record.getByRole("button", { name: "View service report" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Service report", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Labor minutes", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Work performed", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("customer-service-report.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Close report" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh your service" }).click();
  await expect(
    page.getByRole("heading", { name: "Service history", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("customer-portal.png"),
    fullPage: true,
  });
});
