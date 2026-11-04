import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

// Browser layout regression only. This fixture has no authentication, API calls,
// or operational records, and is never used as a product screenshot.
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const title =
  "Synthetic rooftop HVAC equipment inspection and controls troubleshooting "
    .repeat(3)
    .slice(0, 160);
const html = `<style>${css}
.fui-Select{display:flex;align-items:center;position:relative}.fui-Select__select{box-sizing:border-box;flex-grow:1;max-width:100%;height:32px;padding-right:30px;font:inherit}.fui-Button{min-width:96px;min-height:32px;padding:0 12px;white-space:nowrap}
</style><div class="app-layout"><aside class="sidebar">Layout fixture</aside><div class="workspace-main"><main class="page-content"><div class="replay-search"><span class="replay-search-icon">↺</span><div><strong>Find the operational story</strong><small>Choose a work order to inspect its complete event history.</small></div><form><span class="fui-Select"><select class="fui-Select__select" aria-label="Fixture work order"><option>WO-20261104-ABCDEF — ${title}</option></select></span><button class="fui-Button">Investigate</button></form></div><div class="replay-layout"><section class="panel">Timeline fixture</section><aside class="replay-detail"><section class="panel">Evidence fixture</section></aside></div></main></div></div>`;
const browser = await chromium.launch();
let failed = false;
try {
  for (const width of [1512, 1280, 1024, 760, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(html);
    const result = await page.evaluate(() => {
      const content = document
        .querySelector(".page-content")
        .getBoundingClientRect();
      const select = document.querySelector("select").getBoundingClientRect();
      const button = document.querySelector("button").getBoundingClientRect();
      return {
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        contentRight: content.right,
        selectRight: select.right,
        buttonRight: button.right,
      };
    });
    const pass =
      result.documentWidth <= width + 1 &&
      result.selectRight <= result.contentRight + 1 &&
      result.buttonRight <= result.contentRight + 1;
    console.log(JSON.stringify({ width, pass, ...result }));
    failed ||= !pass;
    await page.close();
  }
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;
