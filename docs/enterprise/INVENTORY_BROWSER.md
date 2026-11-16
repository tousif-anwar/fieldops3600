# Inventory browser acceptance

Date: 15 November 2026, America/New_York. Scope: the live local web Inventory workspace through the real Keycloak, gateway, work-order and Inventory APIs. This is browser acceptance of the web application, including its phone layout; it is not native Android/iOS acceptance or external production certification.

## Journey

The [focused Playwright spec](../../apps/web/e2e/inventory.spec.ts) uses the existing PKCE sign-in flow with the generated local manager identity. It runs in both configured projects: desktop Chromium and Pixel 7 mobile Chrome. There are no route fulfillments, mocked business responses, direct database inserts, authentication bypasses or hardcoded bearer tokens.

The journey creates a uniquely named synthetic work order through the existing web UI, registers a synthetic part and warehouse through Inventory catalog forms, and then uses the actual command form to:

1. Receive eight units and verify on-hand/reserved/available values in the stock table.
2. Reserve three for the selected job and verify `8 / 3 / 5`.
3. Go offline and verify stock writes are disabled with the explicit no-offline-queue message; reconnect without changing the recorded balance.
4. Attempt to consume six unreserved units, observe the real HTTP 409, verify stock is unchanged, and use the UI's conflict-recovery refresh.
5. Consume two against the actual reservation, return one unused unit, and release the remaining reservation.
6. Submit a missing-parts request, review job consumption/request history and close that request.
7. Verify the actual movement ledger contains one consumption, the return and release reasons, and the final `7 / 0 / 7` balance.
8. Save the real stock/history screens and verify no document overflow or unexpected page/server errors.

The test reads the browser's legitimate API authorization header only into memory for scoped cleanup. Request traces are disabled for this file so failure artifacts do not retain authorization headers. Success screenshots contain only logged-in synthetic inventory state. Cleanup releases only this job's remaining reservation, closes its own open requests and cancels its own unbooked work order. Parts, stock and immutable movement evidence are retained; existing records are not deleted or rewritten.

## Reproduction

```powershell
cd apps/web
$env:WEB_BASE_URL='http://localhost:8088'
$env:FIELDOPS_LIVE_E2E='1'
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\tousi\AppData\Local\ms-playwright'
npx playwright test e2e/inventory.spec.ts --reporter=list
```

The browser-path override is host-specific; CI installs Chromium through its existing Playwright setup. The spec skips only when live mode or generated local credentials are unavailable. It does not skip the mobile project to conceal a layout failure.

## Iteration evidence

The first attempt exposed a test-selector issue: `getByLabel` did not identify the required Unit field consistently. The spec now uses its observed textbox role/name and a 15-second action timeout. Work-order setup moved into the existing UI so query-cache invalidation also occurs through the real application. Two unbooked synthetic setup jobs from the initial timed-out attempt were subsequently canceled through the real API after verifying they had no reserved stock.

The next desktop run completed every stock, conflict, offline, consumption, return, release, request and history assertion, then correctly failed its layout assertion: document width was **1481 px at a 1280 px viewport**. The mobile run correctly failed because another panel's Field/Select intercepted the catalog disclosure pointer. No forced click or relaxed overflow assertion was introduced.

Read-only browser diagnostics identified the overflowing desktop `.filter-bar > .fui-Field` for “Inventory view”: its intrinsic 231-pixel width and `min-width:auto` extended from x=1250 to x=1481 while the containing filter bar was only 992 pixels wide. The native Fluent select and sibling long work-order/location fields retained intrinsic widths. On the Pixel 7, the workspace was 412 pixels wide but horizontal content expanded `window.innerWidth`/document width to 698 pixels, affecting visual viewport and pointer coordinates. Exact computed rectangles/styles and actual screenshots were saved to `artifacts/enterprise/inventory-layout/{desktop,mobile}.json` and `.png` for the application owner to fix.

The root agent corrected the Inventory filter group to an explicit three-column `minmax(0, 1fr)` grid with shrinkable Field/select controls and a single column on small screens, then rebuilt the actual web image. No forced click or relaxed assertion was needed.

Final rerun: **2/2 passed, zero skips**, 8.4 seconds total. Desktop Chromium completed in 4.8 seconds and the Pixel 7 mobile project in 7.3 seconds. Both completed the full catalog/stock/job/negative-conflict/offline/recovery/consumption/return/request/history journey, including the real stock assertions and fixture cleanup. Document overflow checks passed at the configured desktop 1280-pixel and mobile 412-pixel widths. No unexpected browser exception or API 5xx was observed.

The actual final stock screen was visually inspected for both projects, and the mobile movement-history screen was also inspected. The filters fit their containers, the phone layout stacks the controls, catalog disclosures can be used through ordinary pointer interaction, and wide stock/history tables remain within their labelled scroll regions. The observed stock values are `7` on hand, `0` reserved, and `7` available after the recorded consumption/return/release operations.

Original screenshots are retained under the respective `apps/web/test-results/inventory-manager-records--b4b98-vers-from-unavailable-stock-{chromium,mobile-chrome}/` directories: `inventory-final-stock.png` and `inventory-movement-history.png`. These local test artifacts are ignored files and are regenerated by the spec. Captures are made after scrolling to the top, preserving the actual sticky-header behavior without retouching. The browser suite uses UTC display for reproducible date rendering; this report uses the client's America/New_York date.

## Static verification

The new spec passes its focused ESLint check (`npx eslint e2e/inventory.spec.ts --max-warnings 0`), strict TypeScript compilation with Playwright/Node types (`npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --types node e2e/inventory.spec.ts`), Prettier formatting (`npx prettier --check e2e/inventory.spec.ts`) and whitespace validation. Those checks are distinct from the live browser result. No application, backend or shared test-helper source was changed by this browser-test assignment.
