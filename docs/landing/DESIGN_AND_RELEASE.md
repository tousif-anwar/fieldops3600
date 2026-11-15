# Public website design and release review

Review date: 14 November 2026. Scope: the public GitHub Pages product presentation. The authenticated operations portal, native application, and business services were preserved.

## Release status

**Pre-deployment verification passed.** The owner authorized publication after the initial local review. The website was integrated in an isolated checkout of current `main`, preserving all newer application code and current documentation. This document records the checks before publication; actual deployment status is available in the [Public website Actions runs](https://github.com/tousif-anwar/fieldops3600/actions/workflows/public-site.yml). Platform production readiness is a separate question; this website makes no production, certification, customer, or commercial-offer claims.

Exact browser results, verification scope, and limitations are recorded in [QA results](QA_RESULTS.md). Product claims and image provenance are recorded in [Product evidence](PRODUCT_EVIDENCE.md).

## Before and after

These are rendered website captures, compressed to WebP without retouching. Original PNGs and machine reports remain under `artifacts/landing/`.

| Viewport | Published baseline | Implemented production artifact |
|---|---|---|
| Desktop, 1440 px | [Before](evidence/before-desktop.webp) | [After](evidence/after-desktop.webp) |
| Mobile, 390 px | [Before](evidence/before-mobile.webp) | [After](evidence/after-mobile.webp) |

## Discovery and design decisions

The existing public URL serves a Jekyll-rendered repository README. This branch had no dedicated public-site source or Pages workflow. The React/Vite app is an authenticated operations portal and is not the Pages application. The public URL and checked-out branch have different implementation scopes; public marketing copy was checked against this branch rather than inferred from the published README.

The primary audience is service dispatchers and supervisors; engineering reviewers are a secondary audience. The intended next action is to explore the product and then the walkthrough, documentation, or source. There are no conversion analytics or customer interviews in this assignment, so the hierarchy is a design hypothesis based on the supplied brief and observed page, not a measured conversion improvement.

| Observed evidence | Implemented response |
|---|---|
| Repository title and product title competed as two H1 headings. | One product H1 explains the operational scope. |
| Dense implementation tables preceded any product demonstration. | A real dispatcher screenshot follows the hero; concise capabilities precede architecture. |
| Raw Mermaid code appeared on the homepage. | An accessible HTML system diagram presents service boundaries and data flows. |
| No purposeful product CTA or navigation. | Native links lead to capabilities, workflow, architecture, documentation, and the repository. |
| Baseline mobile axe checks reported link contrast and inaccessible scroll regions. | Explicit link styling, keyboard-accessible navigation and documentation scroll regions, and automated axe checks cover the new artifact. |
| Source contains no assignment-offer or independent equipment registry implementation. | Copy describes assigned work and work-order context without advertising those newer features. |

The visual direction uses a light neutral canvas, white surfaces, dark text, one blue accent, ruled editorial lists, and authentic screenshots. No stock imagery, gradients, decorative animation, fabricated logos, testimonials, results, or sales forms were introduced. The page has no frontend runtime dependencies or external fonts.

## Design system and maintenance

[Shared tokens](../../website/tokens.css) govern both the landing page and rendered documentation. The system defines colors, a 4/8/12/16/24/32/48/64/80 px spacing scale, a 1200 px product container, six-pixel radii, a system font stack, and body/label/heading scales. Body copy is 16 px, supporting labels 13–14 px, section headings 28–36 px, and the hero 36–56 px. Buttons and primary navigation targets are at least 44 px high. Documentation uses a narrower reading column for long technical material.

Reusable visual classes cover section headings, actions, screenshot frames, capability rows, and process steps. Semantic sections, definition lists, ordered lists, figures, and navigation replace unnecessary component wrappers. Small-screen navigation is a progressive disclosure: useful links remain available when JavaScript is disabled. Escape returns focus to its trigger; the control declares its expanded state. Reduced-motion preferences are respected, and content has no scroll-reveal dependency.

Images use WebP derivatives, explicit dimensions, lazy loading below the fold, and native full-size links. The hero has responsive sources and high fetch priority. Android screens stack at phone widths for a larger, more legible image. Genuine development overlays and captured service states are preserved; the historical workflow capture is explicitly dated. Screenshot values represent synthetic captured state, not claimed business results.

Authoritative source: [landing HTML](../../website/index.html), [styles](../../website/styles.css), [navigation behavior](../../website/site.js). Build/preview and publication instructions are in the [website guide](../../website/README.md).

## Skills acquired and applied

| Skill | Application |
|---|---|
| Installed `frontend-design` | Deliberate typography, grid, restrained visual system, and factual content discipline. The user's enterprise direction takes precedence over the skill's prescribed decorative anchors and exact palettes. |
| Installed `landing-page-cro-review` | One real primary action, clear secondary source link, business value before technical detail, and evidence separated from conversion hypotheses. |
| Installed `website-marketing-audit` | Audited hierarchy, proof, useful CTA destinations, metadata, and trust limits without inventing analytics or results. |
| Installed `seo-geo-opportunity-audit` | Read-only review of canonical URLs, indexability, metadata, source identity, and missing measurement evidence. No ranking claim. |
| Installed Vercel `web-design-guidelines` | Current official rules read and applied to semantic structure, focus, link purpose, image dimensions, motion, responsive behavior, and automated accessibility review. |
| OpenAI curated `playwright`, acquired during this task | Applied real-browser interaction, screenshot inspection, and repeat-after-fix workflow. The user's requested tests use the existing pinned Playwright package rather than adding an unpinned CLI runtime. |

The OpenAI curated registry was discovered using the installed skill-installer helper. Before acquisition, the official repository's skill manifest, full instructions, shell wrapper, references, and file inventory were inspected. Source revision: `49f948faa9258a0c61caceaf225e179651397431` in [openai/skills](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/playwright). It contains documentation, assets, and an `npx` wrapper; no installer from the package was executed. The trusted local installer downloaded it to ignored `.local/landing-skills/playwright`. It can be read there in subsequent turns; global skill installation was unnecessary. The wrapper would fetch an unpinned CLI, so verification used the declared, locked browser QA dependencies instead.

The fresh [Vercel web-interface rules](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) and live-site baseline were retrieved during this task. Local review copies and original screenshots remain under `artifacts/landing/`. A draft-only wireframe skill was read for discovery but is not claimed as an implementation skill.

## Deployment boundary

The builder generates static HTML under `.local/public-site/fieldops3600`; the Pages artifact packages that directory's contents. Links and assets retain the `/fieldops3600/` prefix exactly once. Existing Markdown remains authoritative and is rendered to matching `.html` paths. No SPA fallback is needed for direct navigation or refresh. Linked source files open the repository; application bundles, dependencies, ignored credentials, and local environment files are excluded.

The [public-site workflow](../../.github/workflows/public-site.yml) builds and checks changes, preserves QA evidence, and packages the artifact. Pushes and pull requests do not publish. Publishing is restricted to an explicit manual dispatch with `publish=true` on `main` and the GitHub Pages environment. This is a prepared deployment mechanism, not evidence of a remote deployment. GitHub's Pages source setting may need a maintainer change from the current branch/Jekyll mode.

Remaining validation includes remote Actions execution, an authorized Pages publication and smoke check, native screen-reader review, physical touch devices, and browser engines beyond Chromium. Native application acceptance gaps are linked from the public product copy and were not repaired or certified by a website-only change.

## Current-main publication integration

The deployment checkout starts from `e2f2f9edd98f75a507342e38f8d7892866292b0f`. Only the public website, its build/QA scripts, new landing review files, and its workflow were added. Existing application and documentation sources were preserved. The current documentation index is `docs/README.md`; landing links were adapted to those authoritative current paths. Historical evidence retains commit-pinned source links. The browser build runs on Ubuntu 24.04 to match the repository’s supported Playwright runner rather than inheriting a changing `ubuntu-latest` image.
