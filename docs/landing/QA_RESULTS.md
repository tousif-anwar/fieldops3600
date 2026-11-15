# Public landing page verification

Verification date: 14 November 2026. This report concerns the public presentation website, not certification of the authenticated operations platform.

## Existing published site

The production URL `https://tousif-anwar.github.io/fieldops3600/` returned HTTP 200 in Chromium. Before captures are in `artifacts/landing/before/live-1440.png` and `live-390.png`; both were visually inspected. The live site was a Jekyll-rendered README with two H1 elements, a long capability table, raw Mermaid source, and no product images or primary product CTA. Its document width fit 390 pixels, but technical code regions required horizontal scrolling.

Axe-core 4.10.3 on the published mobile page found two failing rule categories: `link-in-text-block` (six links distinguishable only by insufficient color differences) and `scrollable-region-focusable` (two keyboard-inaccessible scroll regions). This is a baseline observation, not a full accessibility audit. Machine evidence is `artifacts/landing/before/audit.json`.

## Reproducing artifact checks

```sh
python scripts/build-public-site.py
npm ci --prefix website --ignore-scripts
npx --prefix website playwright install chromium
node scripts/check-public-site.mjs
```

Linux CI can use `playwright install --with-deps chromium`. For an existing local browser installation, set `PLAYWRIGHT_BROWSERS_PATH` appropriately. The QA package contains development-only pinned Playwright and axe dependencies; it adds no browser runtime dependencies to the page.

The checker serves the actual build artifact under `/fieldops3600/` on an ephemeral loopback port. It records screenshots at 320, 390, 768, 1024, and 1440 pixels, checks document overflow, loaded images and reserved dimensions, alternative text, canonical metadata, one H1 and main landmark, local destinations and fragments, keyboard skip navigation, mobile menu keyboard behavior, navigation without JavaScript, browser errors, and axe WCAG A/AA rules through 2.2. JSON evidence is written to `artifacts/landing/after/audit.json`. `PUBLIC_SITE_URL` can point the same checks at another preview, and `PUBLIC_SITE_QA_DIR` can separate repeated runs.

## Local production artifact results

The production builder and browser checker both exited 0. The expanded verification build rendered 61 Markdown documents, copied 28 documentation media files, and validated 776 local references with no unresolved references. These counts are a dated snapshot; adding documentation changes them.

After saving the four representative before/after captures into maintained documentation, the final documentation-only rebuild passed: 61 Markdown documents, 32 documentation media files, and 780 validated local references. Product source and browser-tested layouts were unchanged by that evidence update.

| Check                             | Observed result                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Responsive widths                 | 320, 390, 768, 1024, and 1440 pixels; document width matched each viewport                                                                                  |
| Automated accessibility           | Zero axe WCAG rule violations at all five widths                                                                                                            |
| Browser errors / failed responses | Zero                                                                                                                                                        |
| Landing local destinations        | 28 paths/fragments/assets returned 200, with referenced fragments found                                                                                     |
| Keyboard                          | Skip link focused main; compact menu opened with Enter; Tab reached a menu link; Escape closed and restored focus                                           |
| Without JavaScript                | Product content and header navigation remained available at 390 pixels                                                                                      |
| Dependency audit                  | QA-only pinned dependencies installed without scripts; npm audit reported zero vulnerabilities                                                              |
| Visual review                     | Desktop 1440 and mobile 390 full-page captures inspected; hierarchy, section alignment, authentic images, captions, and footer checked                      |
| Preserved documentation           | INDEX, INSTALLATION, architecture/overview, and testing/VERIFICATION rendered at 390 and 1440 pixels: eight cases with zero axe violations or page overflow |
| Technical overflow regions        | All 16 observed overflowing code/table regions across the documentation cases were keyboard-focusable                                                       |
| 200% text resizing                | Root font changed from 16 to 32 pixels at a 1440-pixel viewport; document remained 1440 pixels wide and content stayed available                            |
| Reduced motion                    | Browser preference enabled; zero elements had active animations                                                                                             |

Updated screenshots are `artifacts/landing/after/landing-{width}.png`, with expanded compact-navigation captures at 320, 390, and 768 pixels. Documentation screenshots are `docs-index-390.png` and `docs-installation-1440.png` in the same evidence directory; both were visually inspected. The first QA iteration found the missing guided-stage asset; it was supplied from a genuine archived development capture and labelled with its date. The skip-link target was made keyboard-focusable, orphan punctuation removed, and the mobile screenshot crop reviewed during refinement.

The final 200% text stress test also opened the compact menu at 320 and 390 pixels. It initially exposed a 421-pixel document width at 390 caused by architecture-column minimum widths. The compact architecture and navigation layouts were adjusted to one column, and long headings can wrap. Final measured document widths were exactly 320 and 390 pixels, with the menu open and 32-pixel root text. Evidence is `text-resize-menu-320.png` and `text-resize-menu-390.png`. Final desktop and mobile captures were inspected again after the correction. `hero-1440.png` is an actual first-fold browser capture; screenshot preparation clears test focus by clicking an empty header area and does not alter styles or pixels.

A separate empty-cache Chromium lab observation at 390 × 844 used 150 ms latency, 1.6 Mbps download, 750 Kbps upload, and 4× CPU slowdown. Measured two seconds after network idle: first contentful paint **800 ms**, largest contentful paint **800 ms**, cumulative layout shift **0**, and **249 ms** of long-task blocking time. This is one local lab run, not a Lighthouse score, a field metric, or a production speed guarantee. Screenshots use a separate context so eager loading for visual inspection does not affect this observation.

## Verification limits

Automated axe checks cannot establish WCAG conformance. Native screen-reader operation, forced-colors behavior, physical touch devices, browser engines other than Chromium, and GitHub's remote deployment require separate verification. Resource Timing values are local observations, not Lighthouse scores or field Core Web Vitals. No deployment is performed by this checker.

## Skills applied

The installed Vercel `web-design-guidelines` skill was read. Its current official rule source was fetched and read on the verification date (`artifacts/landing/web-interface-guidelines.md`). Checks apply semantic navigation, explicit image dimensions and alt text, visible keyboard access, skip navigation, reduced motion, working anchors, and a responsive Pages base path.

## Authorized deployment checkout

The owner subsequently authorized publication. An isolated checkout of current `main` (`e2f2f9edd98f75a507342e38f8d7892866292b0f`) received only the new website files, build/browser scripts, review files, and workflow. Existing application files and current documentation were preserved. All current documentation routes were mapped and rechecked. The production build passed with 25 Markdown documents, four linked review captures, and 320 validated local references; this replaces the older-checkout counts for publication. The complete browser suite passed again: five viewport widths, eight current documentation cases, 26 local destinations, and zero failures. The deployment run and published URL must be checked separately from these pre-deployment results.
