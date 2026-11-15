/** Render the production Pages artifact, preserving its /fieldops3600/ mount path.
 * Run after: python scripts/build-public-site.py
 * npm ci --prefix website && npx --prefix website playwright install chromium
 * node scripts/check-public-site.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let require = createRequire(path.join(root, "website/package.json"));
try {
  require.resolve("@playwright/test");
  require.resolve("axe-core/axe.min.js");
} catch {
  // Reuse the existing browser QA installation in a development checkout.
  require = createRequire(path.join(root, "apps/web/package.json"));
}
const { chromium } = require("@playwright/test");
const axe = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const output = path.resolve(
  root,
  process.env.PUBLIC_SITE_QA_DIR ?? "artifacts/landing/after",
);
const artifact = path.resolve(root, ".local/public-site");
const canonical = "https://tousif-anwar.github.io/fieldops3600/";
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".xml": "application/xml",
};
mkdirSync(output, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  canonical,
  widths: [],
  links: [],
  failures: [],
};
let server;
let browser;

async function serveArtifact() {
  assert(
    existsSync(path.join(artifact, "fieldops3600/index.html")),
    "Build the public site first.",
  );
  server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const filename = path.resolve(
      artifact,
      "." + decodeURIComponent(url.pathname),
    );
    if (!filename.startsWith(artifact + path.sep))
      return response.writeHead(403).end();
    const candidate =
      existsSync(filename) && statSync(filename).isDirectory()
        ? path.join(filename, "index.html")
        : filename;
    if (!existsSync(candidate) || !statSync(candidate).isFile())
      return response.writeHead(404).end();
    response.writeHead(200, {
      "content-type":
        mime[path.extname(candidate)] ?? "application/octet-stream",
    });
    response.end(readFileSync(candidate));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}/fieldops3600/`;
}

try {
  const base = process.env.PUBLIC_SITE_URL ?? (await serveArtifact());
  report.testUrl = base;
  browser = await chromium.launch();
  const siteOrigin = new URL(base).origin;
  const allLinks = new Set();
  const allResources = new Set();

  for (const width of [320, 390, 768, 1024, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
    const response = await page.goto(base, { waitUntil: "networkidle" });
    assert.equal(response.status(), 200);
    await page.evaluate(async () => {
      for (const image of document.images) {
        image.loading = "eager";
        await image.decode().catch(() => {});
      }
    });
    assert.equal(await page.locator("h1").count(), 1, "Exactly one product H1");
    assert.equal(
      await page.locator("main").count(),
      1,
      "Exactly one main landmark",
    );
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      canonical,
    );
    assert(
      await page.locator('meta[name="description"]').getAttribute("content"),
    );
    assert(
      await page.locator('meta[property="og:image"]').getAttribute("content"),
    );
    const socialImage = new URL(
      await page.locator('meta[property="og:image"]').getAttribute("content"),
    );
    assert.equal(
      socialImage.origin,
      new URL(canonical).origin,
      "Sharing image uses the verified Pages origin",
    );
    allResources.add(new URL(socialImage.pathname, siteOrigin).href);
    assert(await page.locator('link[rel~="icon"]').count());
    assert.equal(
      await page.locator("img:not([alt])").count(),
      0,
      "Every image has alternative text",
    );
    const images = await page.locator("img").evaluateAll((images) =>
      images.map((image) => ({
        src: image.currentSrc,
        loaded: image.complete && image.naturalWidth > 0,
        dimensions: image.hasAttribute("width") && image.hasAttribute("height"),
      })),
    );
    assert(
      images.every((image) => image.loaded),
      "Every product image loads",
    );
    assert(
      images.every((image) => image.dimensions),
      "Images reserve layout space",
    );
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert(
      scrollWidth <= width + 1,
      `${width}px layout overflows to ${scrollWidth}px`,
    );

    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({
      tag: document.activeElement.tagName,
      href: document.activeElement.getAttribute("href"),
      text: document.activeElement.textContent.trim(),
    }));
    assert.equal(firstFocus.tag, "A", "First tab stop is the skip link");
    assert(firstFocus.href?.startsWith("#"), "Skip link targets this page");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.activeElement.tagName),
      "MAIN",
      "Skip link moves keyboard focus to main",
    );

    const toggle = page.locator("header button[aria-expanded]");
    if ((await toggle.count()) && (await toggle.isVisible())) {
      await toggle.focus();
      await page.keyboard.press("Enter");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      const controlledId = await toggle.getAttribute("aria-controls");
      assert(
        controlledId,
        "Navigation toggle identifies its controlled region",
      );
      assert(await page.locator(`[id="${controlledId}"]`).isVisible());
      await page.keyboard.press("Tab");
      assert(
        await page
          .locator(`[id="${controlledId}"]`)
          .evaluate((region) => region.contains(document.activeElement)),
        "Expanded menu is keyboard reachable",
      );
      await page.screenshot({
        path: path.join(output, `navigation-${width}.png`),
      });
      await page.keyboard.press("Escape");
      assert.equal(
        await toggle.getAttribute("aria-expanded"),
        "false",
        "Escape closes mobile menu",
      );
      assert(
        await toggle.evaluate((element) => element === document.activeElement),
        "Menu close restores focus",
      );
    }

    await page.addScriptTag({ content: axe });
    const accessibility = await page.evaluate(async () =>
      window.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      }),
    );
    const violations = accessibility.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    }));
    for (const link of await page
      .locator("a[href]")
      .evaluateAll((links) => links.map((link) => link.href)))
      allLinks.add(link);
    for (const resource of await page
      .locator("img[src], source[srcset], script[src], link[href]")
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          if (element.tagName === "SOURCE")
            return element.srcset
              .split(",")
              .map(
                (source) =>
                  new URL(source.trim().split(/\s+/)[0], document.baseURI).href,
              );
          return [element.src || element.href];
        }),
      ))
      allResources.add(resource);

    await page
      .locator(".site-header")
      .click({ position: { x: width / 2, y: 2 } });
    await page.evaluate(() => window.scrollTo(0, 0));
    if (width === 1440) {
      await page.screenshot({ path: path.join(output, "hero-1440.png") });
    }
    await page.screenshot({
      path: path.join(output, `landing-${width}.png`),
      fullPage: true,
    });
    const timings = await page.evaluate(() => ({
      navigation: performance
        .getEntriesByType("navigation")
        .map(({ domContentLoadedEventEnd, loadEventEnd, transferSize }) => ({
          domContentLoadedEventEnd,
          loadEventEnd,
          transferSize,
        })),
      resources: performance
        .getEntriesByType("resource")
        .filter((resource) => !resource.name.includes("axe"))
        .map(({ name, transferSize, encodedBodySize }) => ({
          name,
          transferSize,
          encodedBodySize,
        })),
    }));
    report.widths.push({
      width,
      scrollWidth,
      images: images.length,
      firstFocus,
      errors,
      violations,
      timings,
    });
    if (errors.length || violations.length)
      report.failures.push({ width, errors, violations });
    await context.close();
  }

  // Check all landing destinations and their fragments, preserving the Pages mount.
  const page = await browser.newPage();
  for (const href of new Set([...allLinks, ...allResources])) {
    const url = new URL(href);
    if (url.origin !== siteOrigin) continue;
    assert(
      url.pathname.startsWith("/fieldops3600/"),
      `Asset or link escapes Pages base: ${href}`,
    );
    const response = await page.request.get(url.href);
    const result = { path: url.pathname + url.hash, status: response.status() };
    if (response.status() !== 200) report.failures.push(result);
    if (url.hash && response.headers()["content-type"]?.includes("text/html")) {
      await page.goto(url.href, { waitUntil: "domcontentloaded" });
      result.fragmentExists = await page.evaluate(
        (fragment) => !!document.getElementById(decodeURIComponent(fragment)),
        url.hash.slice(1),
      );
      if (!result.fragmentExists) report.failures.push(result);
    }
    report.links.push(result);
  }
  await page.close();

  // Progressive enhancement: navigation and product content remain usable with scripts disabled.
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 1000 },
  });
  const fallback = await noJs.newPage();
  await fallback.goto(base, { waitUntil: "networkidle" });
  assert(await fallback.locator("h1").isVisible());
  const details = fallback.locator("header details");
  if (await details.count()) await details.locator("summary").click();
  const navigation = fallback.locator("header nav a[href]");
  assert(await navigation.count(), "Useful navigation without JavaScript");
  assert(
    await navigation.first().isVisible(),
    "Navigation remains reachable without JavaScript",
  );
  report.noJavaScript = "passed";
  await noJs.close();

  report.documents = [];
  for (const documentPath of [
    "docs/README.html",
    "docs/INSTALLATION_AND_SETUP.html",
    "docs/SYSTEM_ARCHITECTURE.html",
    "docs/OPERATIONS_VERIFICATION.html",
  ]) {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const response = await page.goto(new URL(documentPath, base).href, {
        waitUntil: "networkidle",
      });
      await page.addScriptTag({ content: axe });
      const accessibility = await page.evaluate(async () =>
        window.axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
          },
        }),
      );
      const violations = accessibility.violations.map(
        ({ id, impact, nodes }) => ({
          id,
          impact,
          nodes: nodes.map(({ target, failureSummary }) => ({
            target,
            summary: failureSummary,
          })),
        }),
      );
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        overflowRegions: [...document.querySelectorAll("pre, table")]
          .filter((region) => region.scrollWidth > region.clientWidth)
          .map((region) => ({
            tag: region.tagName,
            focusable:
              region.tabIndex >= 0 ||
              !!region.querySelector(
                "a,button,input,select,textarea,[tabindex='0']",
              ),
          })),
      }));
      const result = {
        path: documentPath,
        width,
        status: response.status(),
        ...layout,
        violations,
      };
      report.documents.push(result);
      if (
        result.status !== 200 ||
        layout.scrollWidth > width + 1 ||
        violations.length ||
        layout.overflowRegions.some((region) => !region.focusable)
      )
        report.failures.push(result);
      if (
        (documentPath === "docs/README.html" && width === 390) ||
        (documentPath === "docs/INSTALLATION_AND_SETUP.html" && width === 1440)
      ) {
        await page.screenshot({
          path: path.join(
            output,
            documentPath === "docs/README.html"
              ? "docs-index-390.png"
              : "docs-installation-1440.png",
          ),
          fullPage: true,
        });
      }
      await context.close();
    }
  }

  // Text resizing at 200%, separately from the responsive width checks.
  const textContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const textPage = await textContext.newPage();
  await textPage.goto(base, { waitUntil: "networkidle" });
  await textPage.addStyleTag({
    content: "html { font-size: 200% !important; }",
  });
  await textPage.evaluate(async () => {
    for (const image of document.images) {
      image.loading = "eager";
      await image.decode().catch(() => {});
    }
  });
  report.textResize = await textPage.evaluate(() => ({
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }));
  if (report.textResize.scrollWidth > report.textResize.viewportWidth + 1)
    report.failures.push({ textResize: report.textResize });
  await textPage.screenshot({
    path: path.join(output, "text-resize-200-percent.png"),
    fullPage: true,
  });
  report.reducedMotion = await textPage.evaluate(() => ({
    preference: matchMedia("(prefers-reduced-motion: reduce)").matches,
    animatedElements: [...document.querySelectorAll("*")].filter((element) => {
      const style = getComputedStyle(element);
      return style.animationName !== "none" && style.animationDuration !== "0s";
    }).length,
  }));
  assert.equal(
    report.reducedMotion.animatedElements,
    0,
    "No active animations with reduced motion",
  );
  report.mobileTextResize = [];
  for (const width of [320, 390]) {
    await textPage.setViewportSize({ width, height: 1000 });
    if (
      (await textPage.locator("#nav-toggle").getAttribute("aria-expanded")) !==
      "true"
    )
      await textPage.locator("#nav-toggle").click();
    const result = await textPage.evaluate(() => ({
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      menuExpanded: document
        .getElementById("nav-toggle")
        .getAttribute("aria-expanded"),
    }));
    report.mobileTextResize.push(result);
    if (result.scrollWidth > width + 1 || result.menuExpanded !== "true")
      report.failures.push({ mobileTextResize: result });
    await textPage.screenshot({
      path: path.join(output, `text-resize-menu-${width}.png`),
    });
  }
  await textContext.close();

  // A reproducible lab observation, not a Lighthouse score or field CWV claim.
  const performanceContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const performancePage = await performanceContext.newPage();
  const cdp = await performanceContext.newCDPSession(performancePage);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await performancePage.addInitScript(() => {
    window.publicSiteMetrics = { lcpMs: null, cls: 0, longTaskBlockingMs: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.publicSiteMetrics.lcpMs = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.publicSiteMetrics.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.publicSiteMetrics.longTaskBlockingMs += Math.max(
          0,
          entry.duration - 50,
        );
    }).observe({ type: "longtask", buffered: true });
  });
  await performancePage.goto(base, { waitUntil: "networkidle" });
  await performancePage.waitForTimeout(2000);
  report.mobilePerformance = {
    profile:
      "390x844, 150ms latency, 1.6Mbps download, 750Kbps upload, 4x CPU slowdown, empty cache; 2s after network idle",
    ...(await performancePage.evaluate(() => ({
      ...window.publicSiteMetrics,
      fcpMs:
        performance.getEntriesByName("first-contentful-paint")[0]?.startTime ??
        null,
      resources: performance
        .getEntriesByType("resource")
        .map(({ name, encodedBodySize }) => ({ name, encodedBodySize })),
    }))),
  };
  await performanceContext.close();
} catch (error) {
  report.failures.push({ error: error.stack ?? String(error) });
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  writeFileSync(
    path.join(output, "audit.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}

console.log(
  `Public site QA: ${report.widths.length} responsive viewports, ${report.links.length} local destinations, ${report.failures.length} failures. Evidence: ${path.relative(root, output)}`,
);
if (report.failures.length) {
  console.error(JSON.stringify(report.failures, null, 2));
  process.exitCode = 1;
}
