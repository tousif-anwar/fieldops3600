import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const secret = readFileSync(new URL("../../../.env", import.meta.url), "utf8")
  .match(/^DEMO_PASSWORD=(.+)$/m)?.[1]
  .trim();
const base = "http://localhost:5173";
const routes = ["/work-orders", "/schedule", "/overview", "/supervisor", "/analytics", "/assets/74bdef4f-8be7-4369-a167-3b31669af18d/edit", "/portal"];
const role = process.argv[2] ?? "dispatcher";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
await page.goto(base);
await page.getByRole("button", { name: /Continue to secure sign-in|Sign in/i }).first().click();
await page.locator("#username").fill(role);
await page.locator("#password").fill(secret);
await page.locator("#kc-login").click();
await page.getByRole("navigation", { name: "Main navigation" }).waitFor({ timeout: 45000 });
await page.setViewportSize({ width: 390, height: 844 });
for (const route of routes) {
  await page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, route);
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const viewport = innerWidth;
    const offenders = [...document.querySelectorAll("main *")].map((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: el.className && typeof el.className === "string" ? el.className.slice(0, 100) : "",
        width: Math.round(r.width),
        right: Math.round(r.right),
        scrollWidth: el.scrollWidth,
        overflowX: style.overflowX,
        whiteSpace: style.whiteSpace,
        text: (el.textContent ?? "").trim().slice(0, 60),
      };
    }).filter((x) => x.right > viewport + 1 || x.width > viewport + 1);
    const select = document.querySelector("main select");
    const selectAncestors = select ? (() => {
      const chain = [];
      let el = select;
      while (el && chain.length < 9) {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        chain.push({ tag: el.tagName, cls: typeof el.className === "string" ? el.className.slice(0, 60) : "", width: Math.round(r.width), minWidth: s.minWidth, display: s.display, flex: s.flex, grid: s.gridTemplateColumns, padding: s.padding });
        el = el.parentElement;
      }
      return chain;
    })() : null;
    const scroller = document.querySelector(".table-scroll");
    const scrollerInfo = scroller ? {
      rect: (() => { const r = scroller.getBoundingClientRect(); return { width: Math.round(r.width), right: Math.round(r.right) }; })(),
      clientWidth: scroller.clientWidth,
      scrollWidth: scroller.scrollWidth,
      overflowX: getComputedStyle(scroller).overflowX,
      parent: (() => { const p = scroller.parentElement; if (!p) return null; const r = p.getBoundingClientRect(); return { tag: p.tagName, cls: p.className, width: Math.round(r.width), scrollWidth: p.scrollWidth, overflowX: getComputedStyle(p).overflowX }; })(),
    } : null;
    return { path: location.pathname, viewport, documentWidth: document.documentElement.scrollWidth, selectAncestors, scrollerInfo, offenders: offenders.slice(0, 12) };
  });
  console.log(JSON.stringify(result));
  if (route === "/work-orders") {
    const variants = await page.evaluate(() => {
      const scroller = document.querySelector(".table-scroll");
      if (!scroller) return null;
      const out = {};
      const original = scroller.getAttribute("style") ?? "";
      for (const [name, css] of Object.entries({
        contain: "contain: inline-size",
        clipY: "overflow-x: auto; overflow-y: hidden",
        containPaint: "contain: paint",
        maxWidth: "max-width: 100%; width: 100%;",
        tableFixed: "table-layout: fixed",
        tableFixedWide: "table-layout: fixed; min-width: 640px",
      })) {
        scroller.setAttribute("style", original + ";" + css);
        if (name === "tableFixed") scroller.querySelector("table").style.tableLayout = "fixed";
        out[name] = document.documentElement.scrollWidth;
        scroller.setAttribute("style", original);
        const table = scroller.querySelector("table");
        if (table) table.style.tableLayout = "";
      }
      return out;
    });
    console.log("VARIANTS " + JSON.stringify(variants));
  }
}
await browser.close();
