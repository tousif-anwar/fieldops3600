# Design system

**Foundation:** Microsoft Fluent UI React v9 with the existing `webLightTheme` extended by a small theme override and an enterprise presentation layer appended after the legacy stylesheet. No Tailwind, CSS framework, or component-library replacement was introduced.

## Design intent

Professional service-operations software: neutral surfaces, one blue accent, compact but readable density, clear status semantics, and almost no decoration. Borders and spacing carry structure; shadows are reserved for overlays.

## Tokens

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--blue` | `#1f5aa6` | Primary actions, active navigation rail, focus accent |
| `--blue-strong` | `#174a8c` | Active/hover text, emphasis |
| `--blue-soft` | `#e8eff8` | Active navigation background, selected rows |
| `--ink` | `#243447` | Primary text |
| `--muted` | `#5d6b7c` | Secondary text |
| `--subtle` | `#738092` | Metadata, placeholders |
| `--border` | `#dfe5ec` | Card and section borders |
| `--border-strong` | `#cbd4df` | Input and table dividers |
| `--green` | `#247258` | On-time/completed status |
| `--amber` | `#9b6517` | Warning, at-risk |
| `--red` | `#b6403a` | Breached, overdue, destructive emphasis |
| `--surface` | `#ffffff` | Cards, topbar |
| `--canvas` | `#f4f6f8` | Page background |
| `--sidebar` | `#fafbfc` | Navigation background |

Contrast corrections made during the accessibility pass use darker text variants (`#44566c`, `#526376`, `#58687a`) on light surfaces. Status colour is never the only signal: every chip includes text.

### Typography

| Role | Size / line height | Weight |
| --- | --- | --- |
| Page title (`h1`) | 30 px / 1.22 | 650 |
| Home greeting | `clamp(28px, 2.8vw, 36px)` / 1.16 | 650 |
| Section heading (`h2`) | 19–20 px / 1.3 | 650 |
| Body | 15–16 px / 1.5–1.55 | 400 |
| Navigation item | 14 px / 1.35 | 500; 650 active |
| Button and form label | 14–16 px | 500–600 |
| Table cell | 14–15 px | 400; 600 for identifiers |
| Metadata | 13 px / 1.4–1.6 | 400–600 |
| Nav group label | 12 px uppercase, 0.075em | 700 |

Font stack: `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif`; display headings use `"Segoe UI Variable Display"`. Fluent theme sizes are aligned (`fontSizeBase100` 12, `200` 13, `300` 14, `400` 16, `500` 20, `600` 24).

Rules:

- No operational copy below 13 px; 12 px is limited to uppercase group labels and compact badges.
- Avoid all-caps for sentences. Uppercase is reserved for short group labels and eyebrows (eyebrows are hidden in the enterprise layer).
- Numeric metrics use tabular numerals where alignment matters.

### Spacing, shape, elevation

| Property | Values |
| --- | --- |
| Spacing | 4, 8, 12, 16, 20, 24, 28, 32, 40 px |
| Card padding | 17–20 px; 20 px typical |
| Page content padding | 28 px desktop, reduced at narrow breakpoints |
| Radius | 4 px small controls, 6 px inputs/buttons, 8 px cards/panels |
| Sidebar width | 248 px expanded, 76 px collapsed |
| Topbar | 64 px, sticky |
| Content width | max 1440 px for Home and analytics |
| Shadow | borders first; light shadow only for popovers/dialogs |

### Focus and interaction

- Visible focus ring on all interactive elements; no outline removal.
- Active navigation uses background + inset rail + weight, not colour alone.
- Hover states are subtle background shifts.
- Minimum target: 40 px navigation rows, Fluent default controls (≥32 px), 44 px mobile touch rows.
- Disabled controls remain legible and explain prerequisites through nearby text.

## Layout patterns

| Pattern | Composition | Used by |
| --- | --- | --- |
| Home | Context header, three-figure snapshot, two-column attention/quick access, one secondary panel | `/` |
| Workspace overview | Page header, KPI strip, live list, contextual shortcuts | `/overview`, `/supervisor` |
| List | Page header, filter bar, table, pagination, empty/loading state | `/work-orders`, `/notifications` |
| Detail | Back link, record header with status/actions, primary facts, related history | `/work-orders/:id` |
| Task | Focused form or workflow, validation, explicit completion, cancel/back | `/work-orders/new`, `/workflow/:id`, `/schedule` |
| Analytics | Page header, filters, metric cards, chart panels, definitions, export actions | `/analytics` |
| Settings | Grouped explanatory sections with real capabilities and boundaries | `/administration` |

Pages are not forced into identical card grids: lists use tables, details use record headers, and analytics uses chart panels with data tables.

## Components

### Application shell

- Brand block and workspace/team switch.
- Five navigation groups plus Directory.
- Sticky topbar with breadcrumbs, global work-order search, environment badge, live/polling/offline status, notifications, account menu.
- Sidebar collapse persisted in `localStorage`.
- Off-canvas drawer at ≤900 px with scrim, labelled open/close controls, Escape to close.
- Skip link as the first focusable element.

### Page header

Existing `PageHeader` retained; the enterprise layer hides decorative eyebrows, standardises title size, and constrains descriptions. One primary action per page; secondary actions are outline/subtle.

### Cards and panels

White surface, 1 px border, 8 px radius, header with title and optional description/action. Avoid stacking cards inside cards. The Home snapshot is one bordered region divided by internal rules, not three floating cards.

### Tables

- Sentence-case column headers, 12–13 px uppercase only where already established.
- Identifier in the first column with secondary context beneath.
- Status as text chip; priority and status are separate columns.
- Row actions at the end with a labelled accessible header (`Actions`, visually hidden).
- Horizontal scroll container at narrow widths.
- 10-row pagination with “Showing x–y of n”, Previous/Next, current page.
- URL-backed search/status/priority filters and a clear-filters action.
- Loading, empty, and error states replace the table rather than appearing beside stale rows.

### Forms

Fluent `Field`, `Input`, `Select`, `Button`; visible labels; required markers; inline hints; server errors shown in context; primary action disabled only when the prerequisite is unambiguous. Existing confirmation steps for booking changes, workflow completion, and configuration are preserved.

### Status and feedback

- Text + dot/background; green on-time/completed, amber warning/at-risk, red breach/overdue, neutral information.
- `InlineMessage` for success and recoverable errors.
- `ErrorState` includes retry where a query can be retried.
- `Loading` uses a labelled busy state; Home uses `—` rather than fake zeros.

### Charts

Recharts panels with a heading, description, legend, and accessible data table or source figures. The Analytics tablist is a native `role="tablist"` with roving `tabIndex`, Arrow/Home/End support, `aria-selected`, and `aria-controls`; panels are labelled.

## Responsive rules

| Width | Behaviour |
| --- | --- |
| ≥1280 px | Full sidebar, three-column snapshots, two-column Home grid |
| 1100–1279 px | Tighter page padding; Home secondary column narrows |
| 901–1100 px | Snapshot remains three columns; panels stack where needed |
| ≤900 px | Sidebar becomes an off-canvas drawer; topbar simplifies; analytics and detail grids stack |
| ≤760 px | Home snapshot stacks, header date moves below the greeting, tables scroll, action rows wrap |
| ≤520 px | Single-column everything; search collapses; booking and metric rows reflow; no horizontal page overflow |

Tested widths: 320, 375, 768, 1024, 1440, 1920 px. Reflow at 320 px is used as the zoom/reflow proxy; actual browser zoom steps were not automated.

## Content rules

- Labels describe the user's task, not the backend service.
- One sentence of description per page or panel; no motivational copy.
- Actions are verbs: “Assign”, “Review”, “Continue”, “Open reports”.
- Empty states say what will appear and why it is empty.
- Error states say what failed and what the user can do next.
- Never display a metric without its scope or definition when ambiguity is possible.

## Native mapping

The technician app uses React Native primitives with the same hierarchy: neutral surfaces, blue primary action, text-labelled SLA states, 44 px touch targets, native bottom tabs, and a Home tab focused on the current job. It does not reuse web CSS or reproduce the sidebar.

## Do / do not

**Do**

- Use one accent colour and neutral structure.
- Prefer a border and spacing over a shadow.
- Keep one primary action per region.
- Put scope and freshness beside metrics.
- Test at 320 px and with keyboard only.

**Do not**

- Add gradients, glass effects, blobs, or decorative hero art.
- Turn Home into a KPI wall.
- Use colour alone for SLA or status.
- Add fake controls for unimplemented backend features.
- Introduce a second component library or utility CSS framework.
