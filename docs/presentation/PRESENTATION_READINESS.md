# Presentation readiness

Preparation snapshot: 2026-11-05. This file is a working acceptance record. Checked items identify completed preparation; unchecked items identify remaining validation or explicitly disclosed delivery limitations. A human rehearsal remains a presenter acceptance step when timing is delivered only as an automated estimate. The deck, PDF, finished script and final encoded media must not be called delivered merely because their source content exists.

## Package status

| Deliverable | Current observed state | Required closure |
|---|---|---|
| Main presentation | Two source JSON files contain 50 main slides and 12 appendix slides | Export exact requested PPTX, open/render every slide, inspect and repair |
| PDF | Not yet exported at this snapshot | Export, count all pages, inspect rendering and compare with PPTX |
| Presenter script | Every source slide has notes; 4,846 main-note words | Write final per-slide script, transitions/demo cues/timings and verify notes in exported PPTX |
| Diagrams | 15 editable Mermaid sources and rendered assets exist | Final slide-level readability and connector check |
| Evidence/reference documents | Completed with resolved local links | Reconcile final counts, native outcomes, clip names and ending commit |
| Web media | Six real-role raw WebMs; capture manifest has six ok=true/no-error entries | Encode distribution MP4s, validate metadata/decoding/playback and inventory exact final paths |
| Android media | Fresh native recording work is in progress; initial diagnostic attempt is private | Keep only verified functional clips; record step-level outcomes and skipped/failed steps |
| Architecture media | Editable/rendered diagrams exist; no architecture video claimed | Optional recorded explanation if practical, otherwise appendix/diagram references |
| Technical Q&A | 60 evidence-based questions and answers | Spot-check against final code/verification boundary |

## Content and technical accuracy

- [x] Inspected service/API/domain/persistence/event/security source, migrations, UI/mobile source, Compose, tests and CI.
- [x] Documented actual routes and DTOs in [API reference](API_REFERENCE.md).
- [x] Documented physical schemas and logical boundaries in [data architecture](DATA_ARCHITECTURE.md).
- [x] Mapped 37 principal claims in [evidence matrix](EVIDENCE_MATRIX.md).
- [x] Accounted for 57 discovered feature entries and explicit gaps in [feature/demo matrix](FEATURE_DEMO_MATRIX.md).
- [x] Included all six web role Home experiences in real captures.
- [x] Distinguished a general simulator roadmap from implemented deterministic scenarios.
- [x] Labeled synthetic prediction results, proxy travel, bounded FEASIBLE solve and unverified production outcomes.
- [x] Corrected the warehouse explanation to current SCD2/time-off source and six fact tables.
- [x] Root confirmed warehouse migrations 004/005 in the live ledger.
- [ ] Freeze all source and evidence references at the ending delivery commit.
- [ ] Reconcile any late application fix with an affected-code check and its recorded result.

Backend policy remains authoritative where a UI tile is broader: Replay requires Supervisor or Administrator. Current report signatures support date/technician/category/priority filters, not all requested future filters. Local deployment is not proof of cloud hosting, uptime, production adoption or certified release quality.

## Current executed local checks

These are distinct suites, with overlapping scenarios. Do not add their totals into an invented independent coverage percentage.

| Preparation check | Actual latest reported result | Local evidence |
|---|---|---|
| Backend | 57/57 passed | .local/presentation-backend-tests.log; artifacts/presentation-tests TRX |
| Web | 41/41 passed, nine test files | .local/presentation-web-tests.log |
| Mobile | 23/23 passed plus TypeScript | .local/presentation-mobile-tests.log |
| Warehouse | 32/32 real PostgreSQL cases passed | .local/presentation-warehouse-tests.log |
| Gateway | 7/7 real-process cases passed | .local/presentation-gateway-tests.log |
| Fresh isolated Compose | Seven migration jobs exited zero, readiness/grants/quality passed, own temporary resources removed | artifacts/fresh-compose.json |
| Controlled resilience and terminal faults | Passed in retained earlier executions | artifacts/demo-resilience.json; artifacts/demo-terminal-fault.json |
| Live SignalR and observability | Actual received/persisted notice and denied unauthorized hub; six healthy scrape targets and retained trace evidence | Existing checker scripts and artifacts/observability.json |

Raw logs and generated secrets remain ignored. Historical intelligence/browser/security results keep their own dates/scopes in [verification](../testing/VERIFICATION.md) and must not be represented as freshly rerun solely because the current deck mentions them.

## Native acceptance ledger

| Step | State at this snapshot |
|---|---|
| Debug APK built and installed | Verified |
| Real Keycloak PKCE token exchange | Verified; earlier callback landed on an unmatched route, which is diagnostic evidence |
| Callback route and authenticated tabs initial route | Source fix applied by root |
| SecureStore session restored to authenticated Home after force-stop/relaunch | Verified by root after the fix |
| Fresh complete login-to-Home recording after the final callback fix | Recording/confirmation pending |
| Assigned job and guided form entry | Earlier observed entry exists; fresh clip boundary pending |
| Native stage submission with server receipt | Pending step-level confirmation |
| Assistance request / persisted alert | Pending step-level confirmation |
| Offline draft/queued action and process restart | Pending native confirmation; source tests pass |
| Reconnect/manual sync and conflict recovery | Pending native confirmation; source tests pass |
| Physical device, signed store release and iOS execution | Unverified / environment-dependent |

Replace pending rows only after the corresponding actual observation. A screenshot, successful token exchange or source test cannot stand in for a full native workflow recording.

## Timing and rehearsal

The source allocation totals **2,400 seconds: 40 minutes** for slides 1–50. Slides 51–62 are discussion-only appendix material and have no timed allocation. This is an **automated plan**, not evidence that a human rehearsal occurred.

The 4,846-word main narration is about 37 minutes at 130 words/minute before non-overlapping waits. Demo narration should run during its prepared clips, not be read once and then followed by the same full clip. Allow transition/recovery time and expect delivery pace to change the result. Rehearse to the requested 30–45-minute range; shorten optional walkthrough detail if the run approaches 45 minutes.

- [x] 50 main slides and 12 appendix entries identified.
- [x] Every source slide has explanatory notes and source references.
- [x] Nominal slide allocations sum to 40 minutes.
- [ ] Final script timing matches the encoded clip durations.
- [ ] A real timed rehearsal has been performed and its observed duration recorded separately.
- [ ] Presenter knows the abbreviated route for a 30-minute interview.
- [ ] Presenter can answer questions using the appendix and [technical Q&A](TECHNICAL_QA.md).

## Visual, package and media validation

- [ ] Open the actual final PowerPoint in an available presentation application; state which application was used.
- [ ] Render every slide and inspect it at readable size, not just a contact sheet.
- [ ] Check titles, body text, labels, code size, fonts, clipping, overlap, connectors and screenshot proportions.
- [ ] Verify 62 exported slide pages and all 62 speaker-note records.
- [ ] Verify PDF page count, glyphs, screenshots, diagrams and page order.
- [ ] Verify slide numbering, internal navigation and source hyperlinks.
- [ ] Verify source diagrams remain editable and evidence references remain usable.
- [ ] Check that every video opens, decodes and contains its advertised action.
- [ ] Record codec, dimensions, duration and nonzero file size for each delivered clip.
- [ ] Inspect representative frames for credentials, tokens, private content and unintended diagnostic overlays.
- [ ] Remove failed/diagnostic captures from the success-demo inventory; retain them privately if needed for troubleshooting.
- [ ] Verify files work offline from the intended delivery folder, with no dependency on an unverified public URL.

## Live delivery preflight

1. Follow [demo setup](DEMO_SETUP.md), confirm readiness and select the intended synthetic incident.
2. Open the final deck, presenter notes and local PDF backup.
3. Open prepared dispatcher/supervisor/analyst contexts; keep the remaining three roles in supplementary clips.
4. Confirm native Metro port, adb reverses, emulator/app state and current identity.
5. Check screen sharing, projector aspect ratio, system sound policy and readable code/diagram scale.
6. Close unrelated personal windows, terminal environments and notifications.
7. Keep final MP4 backups ready locally. Clips are silent unless an audio track was actually recorded.
8. State historical versus live observations accurately when a trace expires or a view changes after recording.

| Failure | Presenter response |
|---|---|
| Identity/gateway unavailable | Use validated backup footage; do not introduce an authentication bypass |
| Trace expired | Show explicit not-retained state and correlation metadata, or label a retained earlier trace clip |
| 409 version/booking conflict | Explain the guard and refresh; do not force state or repeatedly change idempotency keys |
| Empty warehouse population | Show unknown/empty values and definitions; do not replace them with fake metrics |
| Native callback/action fails | State the failed step and use only the verified native boundary; never swap in a web mockup |
| Video playback fails | Use PDF/stills and narrate the limitation, without calling a static image an observed successful action |

## Git and delivery closure

Presentation work started from commit **a21f558**. Later intermediate commits are preserved. Do not rewrite history or push externally.

- [ ] Review final staged diff and changed-code checks.
- [ ] Run secret guard and inspect exported notes/media for credentials.
- [ ] Commit verified presentation artifacts and required small application fixes coherently.
- [ ] Record the ending commit in the [presentation delivery report](DELIVERY_REPORT.md).
- [ ] Verify normal service settings are restored and the working tree state is accurately reported.
- [ ] Provide the final PPTX/PDF/script plus exact recording paths and remaining limitations.

