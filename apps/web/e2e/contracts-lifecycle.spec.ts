import { expect, test, type Page, type Response } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  ContractPage,
  ContractRenewal,
  MaintenanceContract,
} from "../src/contract-contracts";
import type { Customer, Page as CustomerPage } from "../src/customer-contracts";
import type { WorkOrder } from "../src/types";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const localEnvironment = existsSync(envPath)
  ? readFileSync(envPath, "utf8")
  : "";
const demoPassword =
  process.env.DEMO_PASSWORD ??
  localEnvironment.match(/^DEMO_PASSWORD=(.+)$/m)?.[1]?.trim();

// Follow the inventory journey's real PKCE/session pattern. Authorization stays
// in memory; retained network traces would expose request headers.
test.use({
  timezoneId: "UTC",
  trace: "off",
  actionTimeout: 15000,
  navigationTimeout: 45000,
});
test.skip(
  process.env.FIELDOPS_LIVE_E2E !== "1" || !demoPassword,
  "The generated local identity and running contract services are required.",
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
  await page.locator("#username").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill(demoPassword!);
  await page.locator("#kc-login").click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect.poll(() => authorization).toBeTruthy();
  return authorization!;
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

function posted(page: Page, path: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === path,
  );
}

async function committed<T>(response: Response): Promise<T> {
  expect(response.ok(), `Contract command returned ${response.status()}`).toBe(
    true,
  );
  return response.json();
}

interface DispatchResult {
  visitId: string;
  workOrderId: string;
  serviceLocationId: string;
  status: string;
  dispatchComplete: boolean;
}

interface ContractAudit {
  id: string;
  action: string;
  actorId: string;
  actorRole: string;
}

test("manager activates, dispatches and renews a real maintenance agreement", async ({
  page,
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
  // This sorts into the real, bounded customer picker without changing its API.
  const customerName = `000 Contract browser ${suffix}`;
  const reason = `Synthetic browser annual renewal ${suffix}`;
  let customer: Customer | undefined;
  try {
    const registration = await page.request.post("/api/customers", {
      headers: { ...headers, "Idempotency-Key": `browser-contract-${suffix}` },
      data: {
        displayName: customerName,
        customerType: "Commercial",
        teamId: "north",
        preferredChannel: "None",
        contacts: [],
        locations: [
          {
            name: `Synthetic contract site ${suffix}`,
            addressLine1: "100 Demonstration Avenue",
            city: "Test City",
            region: "NY",
            postalCode: "10001",
            countryCode: "US",
            status: "Active",
          },
        ],
      },
    });
    expect(registration.status()).toBe(201);
    customer = await registration.json();
    const site = customer!.locations[0];
    expect(site.id).toBeTruthy();
    const today = new Date().toISOString().slice(0, 10);
    const expiry = new Date(`${today}T00:00:00Z`);
    expiry.setUTCDate(expiry.getUTCDate() + 120);
    const expiryDate = expiry.toISOString().slice(0, 10);

    await navigate(page, "Maintenance agreements");
    await expect(
      page.getByRole("heading", {
        name: "Maintenance agreements",
        exact: true,
      }),
    ).toBeVisible();
    const form = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Create and activate",
        exact: true,
      }),
    });
    await form
      .getByRole("combobox", { name: /^Customer/ })
      .selectOption(customer!.id);
    await form
      .getByLabel("Covered service", { exact: true })
      .selectOption("HVAC");
    await form
      .getByLabel("Recurrence", { exact: true })
      .selectOption("Monthly");
    await form.getByLabel("Included visits", { exact: true }).fill("3");
    await form.getByLabel("Parts allowance", { exact: true }).fill("100.00");
    await form.getByLabel("Effective date", { exact: true }).fill(today);
    await form.getByLabel("Expiration date", { exact: true }).fill(expiryDate);
    await form.getByLabel("First visit", { exact: true }).fill(today);
    await expect(
      form.getByRole("checkbox", {
        name: "All equipment owned by this customer",
      }),
    ).toBeChecked();
    const creation = posted(page, "/api/contracts");
    const activation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /^\/api\/contracts\/[^/]+\/status$/.test(
          new URL(response.url()).pathname,
        ),
    );
    await form
      .getByRole("button", { name: "Create and activate", exact: true })
      .click();
    const created = await committed<MaintenanceContract>(await creation);
    expect(created.status).toBe("Draft");
    const active = await committed<MaintenanceContract>(await activation);
    expect(active.id).toBe(created.id);
    expect(active.customerId).toBe(customer!.id);
    expect(active.status).toBe("Active");
    expect(active.plans).toHaveLength(1);
    await expect(
      page.getByText("Agreement created with a recurring plan and activated.", {
        exact: true,
      }),
    ).toBeVisible();
    const detail = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: "Agreement detail", exact: true }),
    });
    await detail
      .getByLabel("Service location for maintenance dispatch", { exact: true })
      .selectOption(site.id!);
    await detail.getByLabel("Generate through", { exact: true }).fill(today);
    const generation = posted(
      page,
      `/api/contracts/${active.id}/visits/generate`,
    );
    await detail
      .getByRole("button", { name: "Generate visits", exact: true })
      .click();
    const generated = await committed<{ generated: number }>(await generation);
    expect(generated.generated).toBe(1);
    const visits = detail.getByRole("region", {
      name: "Maintenance visits",
      exact: true,
    });
    const row = visits.getByRole("row").nth(1);
    await expect(row).toContainText("Pending");
    await expect(
      row.getByRole("button", { name: "Create work order", exact: true }),
    ).toBeEnabled();
    const dispatch = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.startsWith(
          `/api/contracts/${active.id}/visits/`,
        ) &&
        new URL(response.url()).pathname.endsWith("/dispatch"),
    );
    await row
      .getByRole("button", { name: "Create work order", exact: true })
      .click();
    const dispatched = await committed<DispatchResult>(await dispatch);
    expect(dispatched.dispatchComplete).toBe(true);
    expect(dispatched.status).toBe("Created");
    expect(dispatched.serviceLocationId).toBe(site.id);
    await expect(row.getByRole("cell").nth(2)).toHaveText("Created");
    const orderLink = row.getByRole("link", {
      name: "Open work order",
      exact: true,
    });
    await expect(orderLink).toHaveAttribute(
      "href",
      `/work-orders/${dispatched.workOrderId}`,
    );
    await expect(
      row.getByRole("link", { name: "Open Schedule", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Create work order", exact: true }),
    ).toHaveCount(0);

    const orderResponse = await page.request.get(
      `/api/work-orders/${dispatched.workOrderId}`,
      { headers },
    );
    expect(orderResponse.ok()).toBe(true);
    const order: WorkOrder = await orderResponse.json();
    expect(order.id).toBe(dispatched.visitId);
    expect(order.maintenanceVisitId).toBe(dispatched.visitId);
    expect(order.contractId).toBe(active.id);
    expect(order.contractLineId).toBe(active.lines[0].id);
    expect(order.customerId).toBe(customer!.id);
    expect(order.serviceLocationId).toBe(site.id);
    expect(order.status).toBe("Created");
    expect(order.technicianId).toBeNull();
    expect(order.coverageEvaluatedAtUtc).toBeTruthy();
    expect(order.contractLaborCovered).toBe(true);
    expect(order.contractPartsCovered).toBe(true);
    const customerOrders = await page.request.get(
      `/api/work-orders/by-customer/${customer!.id}`,
      { headers },
    );
    expect(customerOrders.ok()).toBe(true);
    const orders: CustomerPage<WorkOrder> = await customerOrders.json();
    expect(orders.total).toBe(1);
    await visits.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("contract-created-visit.png"),
    });
    await orderLink.click();
    await expect(
      page.getByRole("heading", { name: order.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Agreement coverage review", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Awaiting dispatch", { exact: true }),
    ).toBeVisible();
    await navigate(page, "Maintenance agreements");
    await page.getByRole("button", { name: customerName, exact: true }).click();

    const current = await page.request.get(`/api/contracts/${active.id}`, {
      headers,
    });
    expect(current.ok()).toBe(true);
    const sourceBefore: MaintenanceContract = await current.json();
    const auditBeforeResponse = await page.request.get(
      `/api/contracts/${active.id}/history`,
      { headers },
    );
    expect(auditBeforeResponse.ok()).toBe(true);
    const auditBefore: ContractAudit[] = await auditBeforeResponse.json();
    const renewalSection = detail.getByRole("region", {
      name: "Agreement renewal",
      exact: true,
    });
    const renewalEnd = new Date(expiry);
    renewalEnd.setUTCFullYear(renewalEnd.getUTCFullYear() + 1);
    await renewalSection
      .getByLabel("Renewal starts", { exact: false })
      .fill(`${expiryDate}T00:00`);
    await renewalSection
      .getByLabel("Renewal expires", { exact: false })
      .fill(renewalEnd.toISOString().slice(0, 16));
    await renewalSection
      .getByRole("textbox", { name: "Renewal reason", exact: false })
      .fill(reason);
    await renewalSection
      .getByRole("heading", { name: "Renewal", exact: true })
      .click();
    expect(
      await renewalSection
        .locator("form")
        .evaluate((form: HTMLFormElement) =>
          [...form.querySelectorAll("input")]
            .filter((input) => !input.validity.valid)
            .map((input) => ({
              type: input.type,
              value: input.value,
              message: input.validationMessage,
            })),
        ),
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("contract-renewal-ready.png"),
    });
    const layout = await page.evaluate(() => ({
      viewport: {
        width: window.innerWidth,
        visualWidth: window.visualViewport?.width,
        documentWidth: document.documentElement.scrollWidth,
      },
      elements: [
        ...document.querySelectorAll(
          ".panel, .form-body, .form-two, .fui-Field, input, select, button",
        ),
      ]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            tag: element.tagName,
            className: element.className,
            id: element.id,
            text:
              element.tagName === "BUTTON" ? element.textContent : undefined,
            x: rect.x,
            width: rect.width,
            right: rect.right,
            minWidth: style.minWidth,
            maxWidth: style.maxWidth,
            display: style.display,
          };
        })
        .filter(
          (element) => element.right > document.documentElement.clientWidth + 1,
        ),
    }));
    writeFileSync(
      testInfo.outputPath("contract-layout.json"),
      JSON.stringify(layout, null, 2),
    );
    expect(layout.viewport.documentWidth).toBeLessThanOrEqual(
      (page.viewportSize()?.width ?? 0) + 1,
    );
    const [renewalResponse] = await Promise.all([
      posted(page, `/api/contracts/${active.id}/renewals`),
      renewalSection
        .getByRole("button", { name: "Create renewal draft", exact: true })
        .click(),
    ]);
    const renewal = await committed<ContractRenewal>(renewalResponse);
    expect(renewal.sourceContractId).toBe(active.id);
    expect(renewal.sourceVersion).toBe(sourceBefore.version);
    expect(renewal.renewedContractId).not.toBe(active.id);
    expect(renewal.reason).toBe(reason);
    expect(renewal.actorRole).toBe("OperationsManager");
    await expect(
      renewalSection.getByText(reason, { exact: false }),
    ).toBeVisible();
    await renewalSection
      .getByRole("button", { name: "Open renewal draft", exact: true })
      .click();
    await expect(
      detail.getByText("No plan yet.", { exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByText("No visits generated.", { exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByRole("button", { name: "Activate", exact: true }),
    ).toBeVisible();
    const draftResponse = await page.request.get(
      `/api/contracts/${renewal.renewedContractId}`,
      { headers },
    );
    expect(draftResponse.ok()).toBe(true);
    const draft: MaintenanceContract = await draftResponse.json();
    expect(draft.status).toBe("Draft");
    expect(draft.version).toBe(1);
    expect(draft.customerId).toBe(customer!.id);
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0].id).not.toBe(sourceBefore.lines[0].id);
    expect(draft.lines[0].includedVisits).toBe(3);
    expect(draft.lines[0].partsAllowance).toBe(100);
    expect(draft.lines[0].visitsUsed).toBe(0);
    expect(draft.lines[0].partsUsed).toBe(0);
    expect(draft.plans).toEqual([]);
    expect(draft.visits).toEqual([]);
    expect(draft.usage).toEqual([]);
    await detail.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("contract-renewal-draft.png"),
    });
    await renewalSection
      .getByRole("button", { name: "View previous agreement", exact: true })
      .click();
    await expect(
      renewalSection.getByRole("button", {
        name: "View renewed agreement",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      renewalSection.getByRole("button", {
        name: "Create renewal draft",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      visits.getByRole("row").nth(1).getByRole("cell").nth(2),
    ).toHaveText("Created");
    const sourceAfterResponse = await page.request.get(
      `/api/contracts/${active.id}`,
      { headers },
    );
    expect(sourceAfterResponse.ok()).toBe(true);
    expect(await sourceAfterResponse.json()).toEqual(sourceBefore);
    const evidenceResponse = await page.request.get(
      `/api/contracts/${active.id}/renewals`,
      { headers },
    );
    expect(evidenceResponse.ok()).toBe(true);
    expect(
      evidenceResponse
        .headers()
        ["cache-control"].split(",")
        .map((directive) => directive.trim()),
    ).toContain("no-store");
    const evidence: ContractRenewal[] = await evidenceResponse.json();
    expect(evidence).toHaveLength(1);
    const { recordedAtUtc, ...persistedEvidence } = evidence[0];
    const { recordedAtUtc: responseRecordedAt, ...responseEvidence } = renewal;
    expect(persistedEvidence).toEqual(responseEvidence);
    // PostgreSQL stores microseconds; the immediate .NET response can include
    // a seventh fractional digit. Browser time comparisons use milliseconds.
    expect(new Date(recordedAtUtc).getTime()).toBe(
      new Date(responseRecordedAt).getTime(),
    );
    const auditAfterResponse = await page.request.get(
      `/api/contracts/${active.id}/history`,
      { headers },
    );
    expect(auditAfterResponse.ok()).toBe(true);
    const auditAfter: ContractAudit[] = await auditAfterResponse.json();
    expect(auditAfter).toHaveLength(auditBefore.length + 1);
    for (const item of auditBefore) expect(auditAfter).toContainEqual(item);
    expect(
      auditAfter.filter(
        (item) => item.action === "MaintenanceContractRenewed.v1",
      ),
    ).toHaveLength(1);
    await renewalSection.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("contract-renewal-history.png"),
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
    expect(failures).toEqual([]);
  } finally {
    if (customer) {
      // The unique customer bounds cleanup even if a multi-command UI operation
      // failed before its response could be captured. Keep immutable evidence.
      const jobsResponse = await page.request.get(
        `/api/work-orders/by-customer/${customer.id}`,
        { headers },
      );
      expect(jobsResponse.ok()).toBe(true);
      const jobs: CustomerPage<WorkOrder> = await jobsResponse.json();
      for (const order of jobs.items.filter(
        (item) => item.status === "Created" && !item.technicianId,
      )) {
        const cancelled = await page.request.put(
          `/api/work-orders/${order.id}`,
          {
            headers,
            data: {
              expectedVersion: order.version,
              title: order.title,
              priority: order.priority,
              status: "Cancelled",
            },
          },
        );
        expect(cancelled.ok()).toBe(true);
      }
      const agreementsResponse = await page.request.get(
        `/api/contracts?customerId=${customer.id}&pageSize=100`,
        { headers },
      );
      expect(agreementsResponse.ok()).toBe(true);
      const agreements: ContractPage = await agreementsResponse.json();
      for (const agreement of agreements.items.filter(
        (item) => item.status !== "Cancelled",
      )) {
        const cancelled = await page.request.post(
          `/api/contracts/${agreement.id}/status`,
          {
            headers,
            data: {
              operationId: randomUUID(),
              contractId: agreement.id,
              expectedVersion: agreement.version,
              status: "Cancelled",
              reason: "Synthetic contract browser fixture cleanup",
            },
          },
        );
        expect(cancelled.ok()).toBe(true);
      }
    }
  }
});
