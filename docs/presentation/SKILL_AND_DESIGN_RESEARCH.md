# Skill use and presentation design research

Research date: 2026-11-05. This record distinguishes skills actually read, tools actually used, external design references and original presentation choices. None of these sources establishes cloud deployment or production adoption for FieldOps 360.

## Skills applied

| Skill | Actual use in this workstream | Boundary |
|---|---|---|
| Presentations (bundled primary runtime) | Read the skill, visual guidance, implementation/API guidance and finalization requirements. Applied editable evidence, source-linked speaker notes, readable flat compositions and render/inspect/fix acceptance. | Final export/render checks remain separately recorded in PRESENTATION_READINESS.md. Reading a skill is not evidence that the PPTX has passed validation. |
| find-skills | Read local skill instructions, searched configured local skill roots and reviewed the skills.sh directory for relevant presentation/browser/design capabilities. | No popularity count is used as proof of correctness. No claim that every directory entry was installed or read. |
| frontend-design | Read the local skill and applied its content discipline: real product information, deliberate hierarchy, coherent visual direction and no fabricated telemetry or filler. | The user's restrained enterprise presentation brief and presentation-specific guidance govern the deck; no unrelated frontend redesign is implied. |
| agent-browser | Read the available browser skill and used workspace-local CLI 0.41.2 for actual application navigation. | Its direct recording command failed because ffmpeg was absent from that process PATH. Existing Playwright recording supplied the real web captures instead. |

Environment-specific skill sources read by root:

- `C:/Users/tousi/.codex/plugins/cache/openai-primary-runtime/presentations/26.1030.10813/skills/presentations/SKILL.md`
- `C:/Users/tousi/.agents/skills/find-skills/SKILL.md`
- `C:/Users/tousi/.codex/skills/frontend-design/SKILL.md`
- `C:/Users/tousi/.codex/plugins/cache/openai-curated/vercel/5fd93af4/skills/agent-browser/SKILL.md`

The requested names `high-end-visual-design`, `web-design-guidelines` and `improve-codebase-architecture` were not found in the searched local skill roots. The public directory lists related capabilities, but this work does not claim to have read or applied missing local SKILL.md files. Applicable installed presentation/design/browser guidance was sufficient to proceed. The [skills directory](https://www.skills.sh/) informed discovery, not technical feature claims.

## Primary design references

| Primary reference | Relevant convention | Application to this presentation |
|---|---|---|
| [C4 diagram guidance](https://c4model.com/diagrams) | Different structural zoom levels answer different audience questions; supporting dynamic/deployment views complement them. | Separate system context, runtime containers, workflow components and local deployment. Avoid forcing every detail into one architecture image. |
| [Azure Well-Architected architecture diagrams](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams) | Match a diagram to its audience/message, use clear directional relationships, consistent labels and an explicit legend. | Label HTTP/event/data paths; distinguish synchronous solid edges, asynchronous dashed edges and logical references. Keep database ownership accurate. |
| [Fluent 2 typography](https://fluent2.microsoft.design/typography) | Typography creates hierarchy and readability; Fluent uses native/system type stacks for platform familiarity. | Use one readable sans-serif family with deliberate title/body/code roles, generous whitespace and a clear scale. Do not copy small application text sizes onto projected slides. |
| [AWS architecture icon guidance](https://aws.amazon.com/architecture/icons/) | Simple, current service-specific symbols communicate topology and deployment. | Use clear generic shapes for this actual self-hosted stack. Do not draw AWS/Azure services as if the project runs on them. No vendor toolkit or proprietary deck was copied. |

These sources were reviewed for visual communication conventions. They do not support a market-size estimate, adoption claim, uptime guarantee or the performance of this application. Business-scale figures, when mentioned, describe the fictional requirements scenario rather than a measured load test.

## Original visual system

The planned deck uses a 16:9 white canvas with restrained blue, dark ink and neutral rules. Color carries consistent semantics: blue application logic, green data/success, gray infrastructure, amber warning and red failure. Labels carry the meaning independently of color. The editable Mermaid sources and [diagram inventory](diagrams/DIAGRAM_INVENTORY.md) preserve that taxonomy.

The composition stays flat rather than imitating interactive application cards. Each main slide has one central subject, short visible copy and explanatory notes. Tables serve true comparisons/catalogs, diagrams explain relationships, and actual UI captures demonstrate product state. Code excerpts use focused real source lines and exact file references instead of unreadable full-file screenshots.

Target typography follows the user's brief: approximately 28–36 pt titles, 18–24 pt body, 14–18 pt diagram labels and 13–18 pt code where practical. Final font availability and export geometry must be checked against the actual runtime before delivery. Content should be shortened or rearranged before shrinking text below a useful projected size.

Real screenshots retain their proportions and evidence-bearing content. Six-role comparison imagery is drawn from six actual authenticated role captures. Native screenshots and video come from the installed Android application, not a web mockup. No generated illustration stands in for a runtime observation.

## Technical storytelling choices

The narrative follows the service lifecycle before introducing advanced mechanisms:

1. Establish the fictional HVAC coordination problem and the six user responsibilities.
2. Explain boundaries and consistency before naming patterns.
3. Walk one real order through APIs, state, outbox and projections.
4. Connect the eight-stage workflow to durable SLA and supervisor decisions.
5. Present optimization/prediction with measured synthetic results and explicit assumptions.
6. Reconstruct the same incident through replay, warehouse measures and traces.
7. Show actual web/native demonstrations, then discuss tests, operations, tradeoffs and remaining work.

Retrospective rationale is labeled as assessment unless an ADR records the decision. The talk avoids treating every architecture choice as universally optimal. A modular monolith, synchronous integration, BFF session model or managed infrastructure can be reasonable alternatives under different team and operational constraints.

## Pacing and demonstration discipline

The source JSON defines 50 main slides plus 12 appendix slides. Main allocations sum to 2,400 seconds, a nominal 40-minute plan. The approximately 4,846 main-note words and clip transitions require a real rehearsal before asserting an achieved duration. Demo narration should overlap the prepared recording. Long feature coverage belongs in supplementary clips and the feature matrix, not in another dense timed slide.

The web harness records real Keycloak sessions and live backend actions. Its manifest records observed steps rather than inferring demonstration success from a page load. The Android ledger separates APK installation, token exchange, callback/Home return, stage submission and offline recovery. A failed step remains a limitation until a new observation establishes it.

The broader Digital Operations Simulator remains planned. Current deterministic tests, synthetic evaluation and resilience scripts are narrower implemented tools. Similarly, local Docker portability does not mean a verified cloud deployment, and clean scoped scanners do not mean ASVS or WCAG certification.

## Tool and asset provenance

- Fifteen editable Mermaid diagrams reconstruct source relationships. Rendered assets accompany their sources.
- Actual source/API/schema references remain in [API_REFERENCE](API_REFERENCE.md), [DATA_ARCHITECTURE](DATA_ARCHITECTURE.md) and [EVIDENCE_MATRIX](EVIDENCE_MATRIX.md).
- Existing Playwright records the six web role contexts. Workspace-local imageio-ffmpeg provides an absolute encoder path for MP4 distribution; no system-wide PATH modification is required.
- Native Android recording uses the actual emulator/application. Diagnostic failed captures remain private and do not count as successful product demonstrations.
- No external publication, remote push, paid asset dependency, fabricated UI or invented production statistic is part of this presentation work.

## Validation standard

Acceptance requires exported package inspection, every-slide visual review, notes/source checks, PDF review, media decoding/playback checks and a credential review. Passing a geometric or file-integrity check does not prove that a slide is readable or a claim is correct. The [readiness checklist](PRESENTATION_READINESS.md) records those distinct closure steps and the final evidence boundary.

