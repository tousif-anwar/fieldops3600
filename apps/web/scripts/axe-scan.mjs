import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const env = readFileSync(`${root}.env`, "utf8");
const password = env.match(/^DEMO_PASSWORD=(.+)$/m)?.[1]?.trim();
if (!password) throw new Error("DEMO_PASSWORD missing from .env");

const base = process.env.WEB_BASE_URL ?? "http://localhost:5173";
const axeSource = readFileSync(
  fileURLToPath(new URL("../node_modules/axe-core/axe.min.js", import.meta.url)),
  "utf8",
);

// Each entry is [link label, expected h1]. Navigation is done with real link
// clicks so the SPA keeps its authenticated session, exactly as a user would.
const plans = {
  technician: [
    [null, "/"],
    ["Work orders", "/work-orders"],
    ["Schedule", "/schedule"],
    ["My work", "/my-jobs"],
    ["Notifications", "/notifications"],
  ],
  dispatcher: [
    [null, "/"],
    ["Work orders", "/work-orders"],
    ["Schedule", "/schedule"],
    ["Operations overview", "/overview"],
    ["Create work order", "/work-orders/new"],
  ],
  supervisor: [
    [null, "/"],
    ["Work orders", "/work-orders"],
    ["Workflow review", "/my-jobs"],
    ["SLA monitoring", "/supervisor"],
    ["Analytics", "/analytics"],
    ["Operational replay", "/replay"],
  ],
  manager: [
    [null, "/"],
    ["Operations overview", "/overview"],
    ["Analytics", "/analytics"],
    ["SLA monitoring", "/supervisor"],
    ["Operational replay", "/replay"],
  ],
  analyst: [
    [null, "/"],
    ["Analytics", "/analytics"],
    ["All workspaces", "/workspaces"],
  ],
  administrator: [
    [null, "/"],
    ["Administration", "/administration"],
    ["Analytics", "/analytics"],
    ["Operational replay", "/replay"],
    ["All workspaces", "/workspaces"],
  ],
};

const browser = await chromium.launch();
const results = [];

async function login(page, username) {
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: "Continue to secure sign-in" }).click();
  await page.locator("#username").waitFor({ timeout: 20000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.getByRole("navigation", { name: "Main navigation" }).waitFor({ timeout: 45000 });
  await page.locator("main h1").first().waitFor({ timeout: 30000 });
}

async function scan(page, label, username) {
  await page.waitForTimeout(700);
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () =>
    // eslint-disable-next-line no-undef
    axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
      },
    }),
  );
  for (const violation of result.violations) {
    results.push({
      page: label,
      role: username,
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    });
  }
  console.log(`${label} [${username}] -> ${result.violations.length} violation types`);
  for (const violation of result.violations) {
    console.log(
      `   ${violation.id} (${violation.impact}): ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(" | ")}`,
    );
  }
}

// Signed-out entry screen.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: "Continue to secure sign-in" }).waitFor();
  await scan(page, "/ (signed out)", "anonymous");
  await context.close();
}

for (const [username, pages] of Object.entries(plans)) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await login(page, username);
  for (const [label, path] of pages) {
    if (label === "Create work order") {
      // The quick action lives on Home; return there before using it.
      await page.getByRole("link", { name: "Home", exact: true }).click();
      await page.waitForURL((url) => new URL(url).pathname === "/");
    }
    if (label) {
      const link =
        label === "Notifications"
          ? page.locator('a[aria-label^="Notifications"]').first()
          : page.getByRole("link", { name: label, exact: true }).first();
      await link.click();
    }
    await page.waitForURL(
      (url) => new URL(url).pathname === path,
      { timeout: 30000 },
    );
    await page.locator("main h1").first().waitFor({ timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await scan(page, label ?? "/ (Home)", username);
  }
  await context.close();
}

await browser.close();
writeFileSync(
  `${root}docs/ui-ux/evidence/axe-results.json`,
  JSON.stringify(results, null, 2),
);
console.log(`\nTOTAL violation types: ${results.length}`);
for (const item of results) {
  console.log(`- ${item.page} [${item.role}] ${item.id} (${item.impact}) x${item.nodes.length}`);
}
