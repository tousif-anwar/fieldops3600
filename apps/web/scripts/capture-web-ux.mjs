import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Captures authenticated, role-by-role evidence without ever printing or
// persisting the shared local demo password. Tokens remain in memory.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const environmentPath = path.join(root, ".env");
const environment = existsSync(environmentPath)
  ? readFileSync(environmentPath, "utf8")
  : "";
const password =
  process.env.DEMO_PASSWORD ??
  environment.match(/^DEMO_PASSWORD=(.+)$/m)?.[1]?.trim();
if (!password) {
  throw new Error(
    "Generate local demo credentials before capturing authenticated evidence.",
  );
}

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((value) => value.startsWith("--"))
    .map((value) => {
      const [key, ...rest] = value.replace(/^--/, "").split("=");
      return [key, rest.join("=") || "true"];
    }),
);
const phase = args.phase ?? "before";
const base = process.env.WEB_BASE_URL ?? args.base ?? "http://localhost:8088";
const requestedRole = args.role ?? "all";
const evidenceRoot = path.join(root, "docs", "screenshots", "web");
const auditRoot = path.join(root, "apps", "web", "artifacts");
mkdirSync(auditRoot, { recursive: true });

const roles = [
  { key: "technician", username: "technician", label: "Technician" },
  { key: "dispatcher", username: "dispatcher", label: "Dispatcher" },
  { key: "supervisor", username: "supervisor", label: "Supervisor" },
  { key: "manager", username: "manager", label: "Manager" },
  { key: "analyst", username: "analyst", label: "Analyst" },
  { key: "administrator", username: "administrator", label: "Administrator" },
].filter((role) => requestedRole === "all" || requestedRole === role.key);
if (!roles.length) throw new Error(`Unknown role: ${requestedRole}`);

const browser = await chromium.launch();
const audit = [];

const settle = async (page) => {
  await page
    .waitForFunction(
      () => document.querySelectorAll(".loading-state").length === 0,
      undefined,
      { timeout: 15000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
};

const capture = async (page, role, label, consoleErrors) => {
  await settle(page);
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const directory = path.join(evidenceRoot, role.key, phase);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, `${slug}.png`),
    fullPage: true,
  });
  const state = await page.evaluate(() => ({
    headings: Array.from(document.querySelectorAll("h1,h2")).map(
      (node) => node.textContent?.trim() ?? "",
    ),
    rows: document.querySelectorAll("tbody tr").length,
    buttons: document.querySelectorAll("button").length,
    interactiveSmallTargets: Array.from(
      document.querySelectorAll("button, a, input, select"),
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.height < 24;
    }).length,
    horizontalOverflow:
      document.documentElement.scrollWidth > window.innerWidth + 1,
    title: document.title,
  }));
  audit.push({
    role: role.label,
    username: role.username,
    page: label,
    url: page.url(),
    ...state,
    consoleErrors,
  });
  console.log(
    `${role.label} · ${label} · ${state.headings[0] ?? "(no heading)"} · ${state.rows} rows · ${state.interactiveSmallTargets} small targets`,
  );
};

for (const role of roles) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/New_York",
    colorScheme: "light",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const loginButton = page.getByRole("button", {
    name: "Continue to secure sign-in",
  });
  if (await loginButton.isVisible().catch(() => false)) {
    if (role.key === "technician") {
      await page.screenshot({
        path: path.join(evidenceRoot, "shared", phase, "login.png"),
        fullPage: true,
      }).catch(async () => {
        mkdirSync(path.join(evidenceRoot, "shared", phase), {
          recursive: true,
        });
        await page.screenshot({
          path: path.join(evidenceRoot, "shared", phase, "login.png"),
          fullPage: true,
        });
      });
    }
    await loginButton.click();
    await page.locator("#username").waitFor({ timeout: 30000 });
    await page.locator("#username").fill(role.username);
    await page.locator("#password").fill(password);
    await page.locator("#kc-login").click();
  }
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(700);

  await capture(page, role, "Overview", consoleErrors);
  const navigation = await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => ({
        label: link.textContent?.trim() ?? "",
        to: link.getAttribute("href") ?? "",
      })),
    );
  for (const item of navigation) {
    if (item.to === "/") continue;
    const link = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: item.label, exact: true });
    if (!(await link.isVisible().catch(() => false))) continue;
    await link.click();
    await page.waitForTimeout(700);
    await capture(page, role, item.label, consoleErrors);
  }
  const notificationLink = page.getByRole("link", {
    name: /Notifications, \d+ unread/,
  });
  if (await notificationLink.isVisible().catch(() => false)) {
    await notificationLink.click();
    await page.waitForTimeout(600);
    await capture(page, role, "Notifications", consoleErrors);
  }

  await page.setViewportSize({ width: 375, height: 844 });
  const overviewLink = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: /Overview/, exact: true });
  const menuButton = page.getByRole("button", { name: "Open navigation" });
  if (await menuButton.isVisible().catch(() => false)) {
    await menuButton.click();
  }
  if (await overviewLink.isVisible().catch(() => false)) {
    await overviewLink.click();
    await page.waitForTimeout(600);
    await capture(page, role, "Overview mobile", consoleErrors);
  }
  audit.push({
    role: role.label,
    page: "Authenticated role inventory",
    username: role.username,
    navigation: navigation.map((item) => item.label),
  });
  await context.close();
}
await browser.close();
writeFileSync(
  path.join(auditRoot, `${phase}-role-audit.json`),
  JSON.stringify(audit, null, 2),
);
console.log(`Wrote ${audit.length} audit rows to artifacts/${phase}-role-audit.json`);
