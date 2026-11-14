import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Real authenticated, read-only screen audit. No token/storage snapshots are persisted.
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../../..");
const webRoot = resolve(import.meta.dirname, "..");
const phase = process.env.UI_AUDIT_PHASE ?? "before";
const base = process.env.WEB_BASE_URL ?? "http://localhost:8088";
const out = resolve(
  process.env.UI_AUDIT_DIR ?? `${root}/artifacts/frontend-cleanup/${phase}`,
);
mkdirSync(out, { recursive: true });
const secret =
  process.env.DEMO_PASSWORD ??
  readFileSync(`${root}/.env`, "utf8")
    .match(/^DEMO_PASSWORD=(.+)$/m)?.[1]
    .trim();
if (!secret) throw new Error("Generated local demo credentials are required.");
const axe = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const selectedRoles = (
  process.env.UI_AUDIT_ROLES ??
  "technician,dispatcher,supervisor,manager,analyst,administrator,customer"
).split(",");
const widths = (process.env.UI_AUDIT_WIDTHS ?? "1440,390")
  .split(",")
  .map(Number);
if (
  widths.some((width) => !Number.isFinite(width) || width < 280 || width > 3840)
)
  throw new Error("Audit widths must be between280 and3840 CSS pixels.");
const output = {
  phase,
  base,
  capturedAt: new Date().toISOString(),
  viewports: widths,
  screens: [],
  failures: [],
};
const browser = await chromium.launch();
const routeSets = {
  technician: [
    "/",
    "/work-orders",
    "/schedule",
    "/my-jobs",
    "/assets",
    "/notifications",
    "/workspaces",
  ],
  dispatcher: [
    "/",
    "/service-requests",
    "/customers",
    "/customers/new",
    "/assets",
    "/assets/new",
    "/work-orders",
    "/work-orders/new",
    "/schedule",
    "/my-jobs",
    "/overview",
    "/notifications",
    "/workspaces",
  ],
  supervisor: [
    "/",
    "/service-requests",
    "/customers",
    "/customers/new",
    "/assets",
    "/assets/new",
    "/work-orders",
    "/schedule",
    "/my-jobs",
    "/overview",
    "/supervisor",
    "/analytics",
    "/registry-insights",
    "/replay",
    "/notifications",
    "/workspaces",
  ],
  manager: [
    "/",
    "/service-requests",
    "/customers",
    "/customers/new",
    "/assets",
    "/assets/new",
    "/work-orders",
    "/work-orders/new",
    "/schedule",
    "/my-jobs",
    "/overview",
    "/supervisor",
    "/analytics",
    "/registry-insights",
    "/replay",
    "/notifications",
    "/workspaces",
  ],
  analyst: ["/", "/analytics", "/registry-insights", "/workspaces"],
  administrator: [
    "/",
    "/service-requests",
    "/customers",
    "/customers/new",
    "/assets",
    "/assets/new",
    "/work-orders",
    "/work-orders/new",
    "/schedule",
    "/my-jobs",
    "/overview",
    "/supervisor",
    "/analytics",
    "/registry-insights",
    "/replay",
    "/notifications",
    "/administration",
    "/workspaces",
  ],
  customer: ["/portal"],
};
function safe(value) {
  return value
    .replace(/\beyJ[A-Za-z0-9_.-]+/g, "[redacted]")
    .replace(/access_token=[^&\s]+/g, "access_token=[redacted]");
}
async function settle(page) {
  await page
    .waitForFunction(
      () =>
        !!document.querySelector(
          "main h1,main [role=alert],.home-greeting,#kc-form-login",
        ),
      { timeout: 20000 },
    )
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(220);
}
async function capture(page, role, path, suffix = "") {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 760 ? 844 : 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    const name = `${role}-${path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}${suffix}-${width}`;
    await page.screenshot({
      path: `${out}/${name}.png`,
      animations: "disabled",
    });
    const metrics = await page.evaluate(() => {
      const visible = (el) =>
        !!el.getClientRects().length &&
        getComputedStyle(el).visibility !== "hidden";
      const items = [
        ...document.querySelectorAll("button,input,select,textarea,a"),
      ].filter(visible);
      return {
        title: document.querySelector("h1")?.textContent,
        documentWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
        domElements: document.querySelectorAll("*").length,
        wrappers: document.querySelectorAll("div").length,
        panels: document.querySelectorAll(".panel").length,
        nestedPanels: document.querySelectorAll(".panel .panel").length,
        controls: items.length,
        smallTargets: items
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width < 24 || r.height < 24;
          })
          .map((el) => ({
            tag: el.tagName,
            name:
              el.getAttribute("aria-label") ??
              el.textContent?.trim().slice(0, 65),
            width: Math.round(el.getBoundingClientRect().width),
            height: Math.round(el.getBoundingClientRect().height),
          }))
          .slice(0, 30),
        fontSizes: [
          ...new Set(
            [...document.querySelectorAll("main *")]
              .filter(visible)
              .map((el) => getComputedStyle(el).fontSize),
          ),
        ],
        navigation: [
          ...document.querySelectorAll('nav[aria-label="Main navigation"] a'),
        ].map((el) => ({
          text: el.textContent.trim(),
          path: el.getAttribute("href"),
        })),
      };
    });
    await page.evaluate(axe);
    const accessibility = await page.evaluate(async () => {
      const results = await window.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
      });
      return {
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes
            .map((n) => ({
              target: n.target,
              html: n.html,
              failure: n.failureSummary,
            }))
            .slice(0, 20),
        })),
        incomplete: results.incomplete.map((v) => ({
          id: v.id,
          nodes: v.nodes.length,
        })),
        passes: results.passes.length,
      };
    });
    // Fluent's 1px, content-visibility:hidden Tabster focus sentinels are owned by
    // the maintained keyboard-navigation library. Keep raw findings, while the
    // product gate excludes only these verified guards; dialog/background focus
    // findings remain failures and real keyboard trapping is tested separately.
    accessibility.libraryFocusGuards = accessibility.violations.flatMap((v) =>
      v.id === "aria-hidden-focus"
        ? v.nodes.filter(
            (n) =>
              n.html.includes("data-tabster-dummy") &&
              n.html.includes("content-visibility: hidden"),
          )
        : [],
    );
    accessibility.productViolations = accessibility.violations
      .map((v) => ({
        ...v,
        nodes: v.nodes.filter(
          (n) =>
            !(
              v.id === "aria-hidden-focus" &&
              n.html.includes("data-tabster-dummy") &&
              n.html.includes("content-visibility: hidden")
            ),
        ),
      }))
      .filter((v) => v.nodes.length > 0);
    output.screens.push({
      role,
      path,
      width,
      suffix,
      screenshot: `${name}.png`,
      ...metrics,
      accessibility,
    });
    writeFileSync(`${out}/audit.json`, JSON.stringify(output, null, 2));
  }
}
async function spa(page, path) {
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await settle(page);
}
async function roleAudit(role) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/New_York",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  let authorization;
  const errors = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/"))
      authorization = req.headers().authorization ?? authorization;
  });
  page.on("pageerror", (e) => errors.push(safe(e.message)));
  try {
    await page.goto(base);
    const login = page.getByRole("button", {
      name: /Continue to secure sign-in|Sign in/i,
    });
    await login.first().waitFor({ timeout: 20000 });
    if (role === "technician") await capture(page, "anonymous", "/login");
    await login.first().click();
    await page.locator("#username").fill(role);
    await page.locator("#password").fill(secret);
    await page.locator("#kc-login").click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .waitFor({ timeout: 45000 });
    await settle(page);
    const routes = process.env.UI_AUDIT_PATHS?.split(",") ?? [
      ...routeSets[role],
    ];
    async function records(path) {
      if (!authorization) return [];
      const response = await page.request.get(`${base}${path}`, {
        headers: { Authorization: authorization },
      });
      if (!response.ok()) return [];
      const result = await response.json();
      return Array.isArray(result) ? result : (result.items ?? []);
    }
    if (
      !process.env.UI_AUDIT_PATHS &&
      !["customer", "analyst"].includes(role)
    ) {
      const orders = await records("/api/work-orders");
      const order = orders.find((x) => x.status === "Created") ?? orders[0];
      if (order) routes.push(`/work-orders/${order.id}`);
      const workflows = await records("/api/workflows");
      for (const status of ["Active", "Completed"]) {
        const work = workflows.find((x) => x.status === status);
        if (work) routes.push(`/workflow/${work.id}`);
      }
      if (role !== "technician") {
        const customers = await records("/api/customers?page=1&pageSize=1");
        if (customers[0])
          routes.push(
            `/customers/${customers[0].id}`,
            `/customers/${customers[0].id}/edit`,
          );
        const assets = await records("/api/assets?page=1&pageSize=1");
        if (assets[0])
          routes.push(
            `/assets/${assets[0].id}`,
            `/assets/${assets[0].id}/edit`,
          );
      }
    }
    for (const path of routes) {
      try {
        await spa(page, path);
        await capture(page, role, path);
        if (path.startsWith("/work-orders/") && !path.endsWith("/new")) {
          const edit = page.getByRole("button", {
            name: "Edit request",
            exact: true,
          });
          if (await edit.count()) {
            await edit.click();
            await capture(page, role, path, "-dialog");
            await page.keyboard.press("Escape");
          }
        }
      } catch (e) {
        output.failures.push({
          role,
          path,
          error: safe(e.message).slice(0, 500),
        });
      }
    }
    if (errors.length) output.failures.push({ role, errors });
  } catch (e) {
    output.failures.push({ role, error: safe(e.message).slice(0, 500) });
  } finally {
    await context.close();
  }
}
try {
  for (let i = 0; i < selectedRoles.length; i += 3)
    await Promise.all(selectedRoles.slice(i, i + 3).map(roleAudit));
} finally {
  await browser.close();
}
const css = ["styles.css", "enterprise.css", "tokens.css"]
  .filter((name) => existsSync(`${webRoot}/src/${name}`))
  .map((name) => ({
    name,
    body: readFileSync(`${webRoot}/src/${name}`, "utf8"),
  }));
output.css = css.map(({ name, body }) => ({
  name,
  bytes: Buffer.byteLength(body),
  lines: body.split("\n").length,
  gradients: (body.match(/(?:linear|radial|conic)-gradient\(/g) ?? []).length,
  important: (body.match(/!important/g) ?? []).length,
  hexadecimalColors: [...new Set(body.match(/#[\da-fA-F]{3,8}\b/g) ?? [])]
    .length,
}));
try {
  output.bundle = readdirSync(`${webRoot}/dist/assets`).map((name) => {
    const body = readFileSync(`${webRoot}/dist/assets/${name}`);
    return { name, bytes: body.length, gzipBytes: gzipSync(body).length };
  });
} catch {}
output.totals = {
  screens: output.screens.length,
  overflow: output.screens
    .filter((x) => x.documentWidth > x.width + 1)
    .map(({ role, path, width, documentWidth }) => ({
      role,
      path,
      width,
      documentWidth,
    })),
  violations: output.screens.reduce(
    (n, x) => n + x.accessibility.productViolations.length,
    0,
  ),
  rawViolations: output.screens.reduce(
    (n, x) => n + x.accessibility.violations.length,
    0,
  ),
  libraryFocusGuards: output.screens.reduce(
    (n, x) => n + x.accessibility.libraryFocusGuards.length,
    0,
  ),
  failures: output.failures.length,
};
writeFileSync(`${out}/audit.json`, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ directory: out, ...output.totals }));
if (
  process.env.UI_AUDIT_ENFORCE === "1" &&
  (output.totals.overflow.length ||
    output.totals.violations ||
    output.totals.failures)
)
  process.exitCode = 1;
