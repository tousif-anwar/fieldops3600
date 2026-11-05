# UX writing audit

**Method:** compared the baseline screenshots and page chrome at `86c15a8` with the implemented interface. No readability scores, comprehension tests, or user interviews were conducted. The table records visible copy changes, not measured comprehension improvements.

## Principles

1. Say what the user can do, not what the product values.
2. Put scope and freshness next to operational numbers.
3. Keep safety, authorization, and audit language even when it is verbose.
4. Remove duplicate status and repeated explanations.
5. Use sentence case; reserve uppercase for short group labels.
6. Prefer “work order”, “stage”, “booking”, “SLA”, and “technician” consistently.

## Before and after

| Before | After | Reason |
| --- | --- | --- |
| “A clear view of your day.” | “Good morning, Jordan.” + “Your assigned work, current stage, and service deadlines.” | The greeting is human; the summary states the role's actual responsibility. |
| “Your team, work, and service performance in one place.” | Role-specific context and a three-figure snapshot | Replaces a generic promise with current, scoped information. |
| “The next right action” / “Useful shortcuts for a connected service day.” | “Quick access” | Names the region by what it contains; removes marketing tone. |
| “A shared service standard. 30 minutes. Clear signals at every step.” | Removed from Home | The SLA explanation belongs in SLA monitoring/Analytics, not the landing page. |
| “Every action, accounted for.” / “Secure workflows. Clear decisions. A complete operational history.” | Removed from Home; replay keeps “Read-only historical playback” | Support copy was occupying prime operational space. The factual safety label remains where it matters. |
| “Workspace / Overview” | “Home” | Uses the product's new level-one name. |
| “My workflow” | “My work” for technicians; “Workflow review” for supervisors and managers | Same route, different intent. “Workflow” described the backend object, not the task. |
| “Identity & access help” support card | Removed from Home; account menu and Administration remain | Help navigation should not compete with operational work. |
| “Live updates” | “Live” / “Polling” / “Offline” with an accessible description | Shorter and more accurate about the actual connection state. |
| “Choose a work order” (empty select) | Kept, with “Plan an appointment” and “Recommendations explain why a technician is a suitable match.” | The instruction prevents a mistaken dispatch action. |
| “No feasible assignments” / “Try a different time or review required qualifications.” | Kept | Specific recovery guidance. |

## Titles and actions

- Page titles are nouns for destinations (“Work orders”, “Dispatch board”, “SLA monitoring”) and verb phrases for tasks (“Create work order”).
- Primary actions are explicit: “Find qualified technicians”, “Confirm booking”, “Continue job”, “Review conflicts”.
- “Open workspace”, “My work”, “All notifications” describe destination rather than repeating the page title.
- The legacy completed-workflow title “A job well done.” remains. It is friendly but not harmful; it is a candidate for a later consistency pass.
- The dispatch-board empty state “Space to plan your day” remains. It explains the empty state but is more decorative than operational; it is also a later candidate.

## Language retained deliberately

| Copy | Why it stays |
| --- | --- |
| “Read-only historical playback” | Prevents the assumption that replay can mutate operations. |
| “Overlapping confirmed bookings are rejected by the database.” | Explains the constraint before the user attempts a booking. |
| “A reason is required when choosing a different recommendation.” | Explains why the primary action is disabled. |
| “Your identity is valid, but no FieldOps 360 role is assigned.” | Distinguishes authentication from authorization. |
| “Server-authorized access” / “Server-authorized workflows” | States the security boundary without exposing implementation detail. |
| “Times follow your device locale” | Prevents misreading UTC/local timestamps. |
| SLA definitions and metric scope text | Required to interpret compliance and duration figures correctly. |

## Tone and terminology decisions

- **Role names:** “Operations manager” is the display label for the `OperationsManager` realm role; the demo login remains `manager`.
- **“Dispatch board”** is the workspace name; the sidebar label stays “Schedule” because technicians also use it to view their schedule. The page title and Home quick action use “Dispatch board” when the task is assignment.
- **“SLA”** is retained as a domain term and defined in Analytics rather than expanded everywhere.
- **“Warehouse”** is used only in Analyst-facing scope/freshness text, where it describes the reporting data source.
- **No exclamation marks** were added; none of the new operational copy uses motivational language.
- **No fake certainty:** null metrics are “—”, unknown capacity is “Unknown capacity”, and missing report data says so.

## Remaining copy issues

- Some legacy empty states and form hints still use a warmer tone than the new shell.
- A few 12 px uppercase group labels and compact status captions remain below the 14 px body target; they are navigation metadata, not operational content.
- Error messages originating from the API are displayed verbatim. They are accurate but not uniformly action-oriented.

These are documented rather than hidden; changing them would require touching operational flows beyond this redesign's scope.
