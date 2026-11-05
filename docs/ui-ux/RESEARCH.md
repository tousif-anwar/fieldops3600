# Enterprise portal research

**Scope:** FieldOps 360 web portal and technician mobile app  
**Research date:** November 2026  
**Method:** review of public product documentation and established UX guidance. No FieldOps 360 user interviews, diary studies, or benchmark timings were conducted. Statements about user behaviour below are hypotheses derived from the product's task model, not measured research findings.

## Sources reviewed

| Source | What was studied | What informed this redesign |
| --- | --- | --- |
| [Azure portal overview](https://learn.microsoft.com/en-us/azure/azure-portal/azure-portal-overview) | Portal Home, resource navigation, global search, breadcrumbs, notifications, consistent page layouts | A single portal shell, breadcrumbs on deeper pages, search in the header, and a consistent page-header pattern. |
| [AWS Management Console documentation](https://docs.aws.amazon.com/awsconsolehelpdocs/latest/gsg/what-is.html) | Console Home, service discovery, recently used services, navigation hierarchy, resource lists and details | Role-oriented quick access and a workspace directory that supports both familiar shortcuts and discovery. AWS's service catalogue depth was deliberately not copied. |
| [Personalize the user experience, Dynamics 365](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/get-started/personalize-user-experience) | Role-based workspaces, dashboards, record lists/details, action panes, saved personalization | A role-specific Home, task-oriented workspaces, stable command placement, and preference persistence for navigation state. |
| [Fluent 2 design principles](https://fluent2.microsoft.design/design-principles) | Typography, spacing, colour tokens, navigation, cards, tables, focus states, accessibility | Fluent UI remains the component foundation; the enterprise layer uses a restrained neutral palette, a predictable type scale, and visible focus. |
| [Nielsen's ten usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | Visibility of system status, match to the real world, user control, consistency, recognition over recall, error prevention | Task names instead of service names, explicit loading/empty/error states, confirmation and recovery in existing workflows, grouped navigation. |
| [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/) | Contrast, target size, reflow, focus visible, name/role/value, headings, tables | Accessibility acceptance criteria and the automated checks reported in `ACCESSIBILITY_REPORT.md`. |

Additional HCI concepts used as design rationale (not measured in this project): Hick-Hyman law (fewer competing choices), Fitts's law (larger, closer targets), Gestalt grouping (proximity and common regions), progressive disclosure (summary first, detail on request), and information scent (labels that predict their destination).

## Design principles applied

### 1. Recognition over recall

**Observed problem:** the legacy shell exposed a flat, service-shaped list and dropped every role on the same overview page. Users had to remember where a feature lived and interpret whether the page applied to them.

**Decision:** every role receives a Home that names its role and team, then surfaces the role's current work. Persistent grouped navigation and breadcrumbs repeat location. Work-order filters are encoded in the URL so a filtered view can be linked or restored after reauthentication.

**Fit:** field operations users move between office and mobile contexts; remembering a service-oriented menu is unnecessary cognitive work.

**Validation:** six-role browser matrix checks the expected Home context, attention panel, and authorized navigation; deep-link test verifies query restoration.

### 2. Match the real world, not the service map

**Observed problem:** navigation used implementation vocabulary such as "My workflow" and "Overview" while users think in tasks: my jobs, dispatch board, SLA monitoring, reports.

**Decision:** labels describe the work: Home, Work orders, Schedule, My work, Workflow review, SLA monitoring, Operational replay, Analytics, Administration. Technical metadata remains inside disclosure panels.

**Fit:** the backend still has separate workflow, scheduling, reporting and notification services. The interface no longer makes that architecture the user's problem.

**Validation:** navigation labels are asserted per role in `apps/web/e2e/roles.spec.ts`; the workspace directory uses the same vocabulary.

### 3. Progressive disclosure and limited choice

**Observed problem:** a single dense overview mixed KPIs, live operations, shortcuts, support copy, and a service-standard explanation. Every role saw the same density and the same priorities.

**Decision:** Home shows a small role-specific snapshot, one attention panel, and at most three quick actions. Deeper analysis stays in Analytics; detailed records stay in work-order and workflow pages. The sidebar has five meaningful groups at most.

**Fit:** dispatchers and technicians need a next action, not a report. Managers and analysts need a stable entry point before they choose a report.

**Validation:** role Home screenshots at 1440 px; axe scan of all Home variants; responsive reflow at 320–1920 px.

### 4. Visibility of system status

**Observed problem:** SLA risk, loading, offline state, and empty results were inconsistent across pages. Some empty states used friendly copy that did not explain what would appear.

**Decision:** status is carried by text plus colour, never colour alone. Home distinguishes loading (`—`), a real zero, and no data. The shell exposes live/polling/offline state and an offline banner. Errors preserve the retry action.

**Fit:** operational decisions depend on knowing whether data is current and whether a number is genuinely zero.

**Validation:** existing component tests for empty/all-null analytics populations; axe contrast checks; offline handling retained from the existing shell.

### 5. Consistency and predictable layout

**Observed problem:** pages used different heading sizes, spacing, card treatments, and action placement. Tiny labels (8–11 px) appeared in workflow, booking, and replay surfaces.

**Decision:** one page-header component, one card/panel treatment, one type scale, one table pattern, and one set of status tokens. The enterprise layer is loaded after the legacy stylesheet so operational pages inherit the scale without rewriting their behaviour.

**Fit:** a mature operations product needs visual predictability across roles and screens.

**Validation:** visual review of login, six Homes, work orders, detail, schedule, SLA, analytics, replay, administration, and responsive widths; axe scan on 30 role/page combinations.

### 6. Error prevention and safe operations

**Observed problem:** destructive and state-changing actions competed visually with navigation and could be triggered without context.

**Decision:** primary actions are visually distinct; existing validation, confirmation, and audit requirements are preserved. Replay remains explicitly read-only and is labeled as such. No backend feature was invented for Home.

**Fit:** dispatch, workflow completion, and configuration changes have operational and audit consequences.

**Validation:** existing unit tests for invalid work orders and server rejection; live dispatcher test creates a real request and confirms a booking; supervisor replay test verifies no operational mutation.

## What was deliberately not copied

- Azure's resource-provider depth and favourites: FieldOps 360 has no favourites API, so no fake favourite control was added.
- AWS's service catalogue: a role-filtered workspace directory is enough for eight workspaces.
- Dynamics' configurable personalization surfaces: only sidebar collapse state is persisted locally.
- Fluent's marketing-site treatments: no gradients, hero illustrations, glass effects, or decorative metrics.

## Limitations

- Product documentation describes intended patterns; it does not prove they work for FieldOps 360 users.
- No comparative usability benchmark was run. Click counts in `USER_JOURNEYS.md` are route-derived, not observed user behaviour.
- Automated accessibility checks cover a subset of WCAG 2.2 AA. They do not replace screen-reader, zoom, or native-device testing.
