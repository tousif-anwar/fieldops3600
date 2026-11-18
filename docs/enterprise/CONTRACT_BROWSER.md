# Maintenance agreement browser acceptance

Updated: 18 November 2026, America/New_York. Scope: the real local web application through Keycloak, the gateway, customers and work-orders. This evidence does not cover technician service completion, native mobile execution, an external provider, or production certification.

## Journey

[contracts-lifecycle.spec.ts](../../apps/web/e2e/contracts-lifecycle.spec.ts) runs generic and restricted-equipment variants in desktop Chromium and the configured Pixel 7 browser project: four cases in total. It uses the real PKCE manager sign-in and seeds a uniquely named synthetic customer/site through the authorized API. The restricted variant also registers an owned HVAC asset using the actual customer version and site. It does not mock or fulfill business requests, insert database rows, bypass authentication, or store bearer tokens in artifacts. Network traces are disabled for this spec.

The journey performs these operations through the actual UI:

1. Create an agreement with one HVAC line, three included visits, a parts allowance, a monthly plan, and an explicit expiration; activate it.
2. Choose the customer's site, generate one visit and create its maintenance work order.
3. Verify the canonical job has the visit's deterministic ID, source contract/line, customer/site, coverage review, Created status, no technician, and one job for the synthetic customer.
4. Open that work order and inspect its coverage and dispatch state.
5. Return to the agreement and amend its future recurrence through the operator editor, using an explicit future date, active site and reason. Verify both concurrency versions advance, line/equipment identity remains, audit captures the change, and the previously generated visit and work order are unchanged.
6. Create an explicit future renewal draft with a reason.
7. Open the new draft and verify fresh coverage-line identity, retained terms and equipment, zero usage, no copied visits/plans, and Draft status. Follow its history link back and verify the source agreement is unchanged by renewal, with one appended renewal audit record.
8. Verify private-cache directives, native form validity, document bounds and unexpected browser/API failures. Save actual visit, amended recurrence, renewal-ready, draft and history screens.

The recurrence-amendment extension was added on 18 November and is pending rebuilt-runtime verification. The earlier passing results below cover the workflow before this extension; they must not be used to claim that the new editor has passed acceptance.

Cleanup is bounded to the unique synthetic customer. It cancels its own unassigned Created work order(s) and agreement(s), retains immutable history and never deletes or rewrites existing records.

## Reproduction

```powershell
cd apps/web
$env:WEB_BASE_URL='http://localhost:8088'
$env:FIELDOPS_LIVE_E2E='1'
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/tousi/AppData/Local/ms-playwright'
npm run test:e2e:live
```

The browser path is specific to this host. CI uses its installed Chromium. Both projects are enabled; the focused contract spec skips only if live mode or generated local credentials are unavailable.

The live runner executes desktop and mobile as separate phases with two workers and a fresh 61-second gateway request window before each phase, including the initial phase after other integration checks. It preserves artifacts in `test-results/chromium` and `test-results/mobile-chrome` and writes each project's exit status to `test-results/live-run-summary.json`. A failed first project does not suppress the second; any failure produces a nonzero final exit status. No request retry, authorization bypass, changed rate limit or business-response mock is introduced.

## Final result and iteration findings

The first rebuilt-runtime generic journey passed **2/2, zero skips**, in 7.3 seconds. After adding the restricted-equipment variant, the focused journey passed **4/4, zero skips**, in 9.4 seconds: generic desktop 5.1 seconds, restricted desktop 5.4 seconds, generic Pixel 7 8.1 seconds and restricted Pixel 7 7.5 seconds. All four completed create/activate/generate/dispatch/owner-reference/renewal/draft/history and scoped cleanup. These results precede the recurrence-amendment extension and do not claim appointment booking or technician completion.

The earlier full-suite attempt reported **43 passed, 14 intentional mobile skips and three failures**. Real HTTP 429 responses showed that the focused run followed immediately by the full suite exhausted the manager identity's existing 240-request fixed window. A later attempt with four workers and a fresh initial window still left three failed mobile cases in the saved `.last-run.json`; their retained error-context files explicitly show 429 responses. Desktop screenshots and mobile failure artifacts do not establish a fully passing run. The paced two-phase runner is pending execution against the updated runtime.

An earlier Pixel 7 run correctly failed the document-bounds gate. At its 412-pixel visual viewport, `document.documentElement.scrollWidth` and `window.innerWidth` expanded to **658 pixels**. The recurring-plan and generation form containers started at x=16 and measured 642 pixels wide; their child Fields measured 602 pixels. The site select also retained `min-width:auto`, measured 422 pixels, and extended to x=438. The inspected screenshot showed clipped controls and text. This explained why ordinary mobile renewal clicks could finish without a POST. The root agent added scoped shrinkable contract grids/children, constrained the site select and stacked phone form columns. No forced click, synthetic form submission or relaxed overflow limit was introduced.

Final read-only computed layout results are saved to each project's `contract-layout.json`: document and visual widths are both **412 pixels** on Pixel 7 and **1280 pixels** on desktop, with no overflowing form elements. Artifacts live under `apps/web/test-results/contracts-lifecycle-manage-79933--real-maintenance-agreement-{chromium,mobile-chrome}/` and are regenerated by Playwright.

The actual final desktop renewal-history image and Pixel 7 created-visit, renewal-ready, renewal-draft and renewal-history images were visually inspected. Controls remain within the workspace, phone date fields stack, and wide tables remain in their labelled scroll regions. The displayed source link, unassigned Created visit, fresh Draft and renewal reason match the API evidence. The renewal draft's plan-start input now shows its future effective date. Images are `contract-created-visit.png`, `contract-renewal-ready.png`, `contract-renewal-draft.png` and `contract-renewal-history.png` in each project's artifact folder.

Earlier iterations corrected test assumptions without changing application behavior:

- The job heading now uses the canonical owner-returned title; the owner normalizes it to the category and maintenance due date.
- Browser-driver `datetime-local` fill accepts the intended midnight value at minute precision. The resulting explicit UTC instants are unchanged.
- Cache-Control is checked for its `no-store` directive because the local reverse-proxy chain repeats that directive.
- Renewal evidence compares all immutable fields exactly and its recorded instant at browser millisecond precision. PostgreSQL stores microseconds, while the immediate .NET response may include a seventh fractional digit.

The first layout rebuild exposed a second application issue: selecting a new agreement before its plan/activation commands completed allowed its detail query to cache Draft version 1. The register and mutation response showed Active, but the detail remained Draft and its Generate button stayed disabled. The root fix explicitly seeds/invalidates the created agreement's detail cache after activation. The passing final run verifies the detail shows the activated plan and enables generation in both projects.

Earlier no-POST timeouts could reject a response waiter before its promise was attached, ending the test context before cleanup completed. Generation and renewal now await the ordinary click and response together, and generation asserts the button is enabled before creating its response waiter. These checks preserve the real UI behavior and make cleanup reliable on failure.

The retained fixtures were reconciled through actual authorized APIs with root approval. Exact `000 Contract browser <eight-hex-character suffix>` names had to match their `Synthetic contract site <same suffix>` and fixed demonstration address. Each job was checked for no booking or workflow activity before cancellation. The first reconciliation examined 14 matching customers and cancelled two unassigned Created jobs and two agreements. A second reconciliation targeted only suffixes `1179fbc3` and `6a7425dc`, verified zero jobs, and cancelled their two agreements. No customer/site was deleted or deactivated, and no immutable record was changed.

## Static verification

The focused spec passes Prettier, `npx eslint e2e/contracts-lifecycle.spec.ts --max-warnings 0`, and strict standalone TypeScript compilation with Playwright/Node types. These checks are distinct from the final live browser result.
