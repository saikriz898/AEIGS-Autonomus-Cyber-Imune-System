# AEGIS

AEGIS is one locally usable defensive cybersecurity demonstration. The complete app lives in this `prototype/` folder. A shared workspace connects inventory, findings, a Digital Twin, modeled paths, deterministic simulations, ranked defensive recommendations, human review decisions, reports, and audit history.

The application is useful immediately with 12 synthetic assets, 12 directed relationships, 10 illustrative findings, three scenarios, and five recommendations. It requires no API keys, backend, account, or external service.

## Install and run

Use Node.js 20.18 or newer; Node.js 22 LTS is recommended. This repository uses Vite 6 to support the available Node.js 20.18 runtime.

```powershell
cd D:\AEIGS\prototype
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The development server binds to loopback only. The port is fixed, so stop another service on port 5173 if Vite reports that it is in use. Dependencies are downloaded during installation; the running application needs no external API connections.

Run all commands below from `D:\AEIGS\prototype`. Stop the server with **Ctrl+C**.

For a production build and local preview:

```powershell
npm run build
npm run preview
```

Open the local preview URL printed by Vite, normally **http://127.0.0.1:4173**. The compiled application is written to `dist/`. The preview origin has its own browser storage, separate from the development origin.

## Try the connected workflow

1. Open **Scope & workspace** to read or edit the local workspace name and authorized demo description. Saving these fields changes shared context and future reports; scope text never starts discovery or adds real targets.
2. In **Discovery**, refresh the seeded inventory. This refreshes local sample timestamps and restores missing sample assets while preserving existing analyst edits. No address or domain is scanned or resolved.
3. In **Asset Inventory**, search by name, address, service, or owner and filter by asset type or exposure. Open an asset to review services, status, findings, relationships, and simulation history. Edit its local owner, notes, criticality, exposure, or status.
4. Open a finding in **Risk Intelligence**. Review its seeded evidence, contributing factors, and full risk calculation. Changing its local review status updates shared scores; a resolved finding contributes zero points.
5. Select the same asset in the **Digital Twin**. Review the relationship register to distinguish observed demo data, inferred access, and hypothetical relationships. All three classes are authored sample data.
6. In **Attack Path Explorer**, choose starting and destination assets and analyze directed routes. Read assumptions and modeled impact. If the endpoints match a seeded scenario, **Simulate this scenario** opens it preselected. Other endpoint pairs open the available scenario chooser; they do not create custom scenarios. Paths represent possibilities, never confirmed compromises.
7. In **Attack Simulation**, run the selected scenario against the graph. The result stores modeled steps, assumptions, affected assets, and outcome. Earlier runs remain available. **Review recommendations** carries the recorded run into Defense Advisor.
8. In **Defense Advisor**, inspect ranks, estimated reduction, disruption, effort, and rationale. The simulation context marks recommendations on affected path assets; use **Related to simulation** to filter them. Global ranks remain unchanged, and relevance does not prove effectiveness. Open a recommendation in **Guardian Gate**, approve or reject, and enter notes. The decision records the analyst display name and time, linking to the latest simulation containing its affected asset when one exists.
9. Review **Audit Logs** for discovery, asset edits, simulation activity, review decisions, report actions, and preference changes. Search and filter the actual local history.
10. In **Reports**, generate a workspace snapshot, read it, and download it as Markdown. Reports preserve the data at generation time. Generate another report after edits to include the latest state.

**Threat Intelligence** connects illustrative historical CVE and ATT&CK references to findings. **AI Agent Center** describes planned roles and displays actual recorded local workflow activity. **ML Model Center** shows dataset counts and explicitly untrained/planned models. **Settings** saves the analyst display name, compact layout preference, and reduced-motion preference locally.

## Transparent calculations

These rules are planning heuristics. They are not machine learning, validated detection, or estimates of the probability of a successful attack.

For an active finding:

```text
base contribution = round(base score × 7, 1 decimal place)
finding risk = min(100, round(base contribution + exposure + criticality))
```

| Factor                     | Points |
| -------------------------- | -----: |
| Internet exposure          |     15 |
| Internal exposure          |      5 |
| Isolated exposure          |      0 |
| Critical asset criticality |     15 |
| High asset criticality     |     10 |
| Medium asset criticality   |      5 |
| Low asset criticality      |      0 |

Resolved findings contribute zero. Calculated risk bands are **Critical ≥75**, **High ≥50**, **Medium ≥25**, and **Low <25**. The finding's seeded severity is a separate analyst classification and does not change when its calculated score changes. Asset risk is its highest active finding score. Workspace risk is the rounded arithmetic mean across all asset scores. A zero score does not validate security.

Recommendation ranking is:

```text
priority = estimated risk reduction × 2 − operational disruption × 5 − implementation effort × 3
```

Reduction is an illustrative estimate from 0–100 points; disruption and effort use a 1–5 scale. Higher priority ranks first, with a stable identifier tie-break. Estimates are seeded and do not claim measured defensive efficacy. The latest human review decision appears with each recommendation; all earlier decisions remain in history.

Path analysis uses bounded, directed depth-first graph traversal, excludes cycles, and returns up to 20 routes containing at most seven assets (six relationships). Results sort by route length and stable identifier. A scenario evaluates the first returned route and uses the highest asset risk along that route as its modeled risk score. Identical workspace data and scenario inputs produce the same modeled steps and outcome; run identifiers and timestamps are new for each record. A missing route only means the bounded sample model found none.

## Local data and persistence

The workspace uses browser `localStorage` under **`aegis.workspace.v1`**, with schema **version 1**. Asset edits, finding statuses, scope, settings, simulations, decisions, reports, and audit records share that one workspace.

Storage is scoped to the browser profile and exact origin. Other browsers, private sessions, or another localhost port have separate data. No cloud synchronization or cross-tab conflict resolution is provided. Reloading normally preserves saved changes. Clearing site data removes the local workspace; the next load uses the seed dataset again.

Stored data is validated at the storage boundary, including record types, allowed values, and references. Invalid JSON, incompatible versions, or invalid records load a fresh in-memory demo with a visible warning rather than crashing. The original saved value is not deleted during loading; a later successful workspace mutation can replace it. If storage is blocked or full, the application keeps the current tab usable and explains that changes might not survive a reload. Download a report to retain a readable snapshot. Reports are not restorable workspace backups.

Scope and analyst names are user-entered local context, not authenticated identity or proof of authorization. Review notes are displayed as text. Browser storage is not a secure store for secrets; use synthetic data only.

## Architecture

The implementation uses React, TypeScript, Vite, and Lucide icons. Business rules and storage are separate from presentation so a backend can replace the local persistence layer later.

| Location                                    | Responsibility                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/types.ts`                       | Shared assets, relationships, findings, scenarios, simulations, recommendations, approvals, audit records, reports, and workspace contracts |
| `src/domain/seed.ts`                        | Authored synthetic enterprise dataset with reserved example IPs and domains                                                                 |
| `src/domain/engine.ts`                      | Deterministic risk, graph traversal, simulation, recommendation ranking, and report generation                                              |
| `src/domain/storage.ts`                     | Validated localStorage loading and saving, isolated behind a small service API                                                              |
| `src/state/WorkspaceContext.tsx`            | Shared state, local actions, validation, navigation, feedback, and audit recording                                                          |
| `src/components/`                           | Shared UI, asset/finding detail dialogs, and selectable asset topology                                                                      |
| `src/pages/CorePages.tsx`                   | Command Center, inventory, risk, and Digital Twin                                                                                           |
| `src/pages/WorkflowPages.tsx`               | Paths, simulation, recommendations, Guardian Gate, and audit history                                                                        |
| `src/pages/SupportingPages.tsx`             | Scope, discovery, threat context, agent/model availability, reports, and settings                                                           |
| `src/styles.css`, `src/pages/workflows.css` | Shared responsive visual system and workflow layouts                                                                                        |

Navigation uses URL hash routes and runs as one application. Assets and findings open shared detail views rather than separate prototypes. Report content is generated from the current workspace and saved as a historical text snapshot. A Guardian Gate decision creates an approval/rejection record and audit entry: it does not remove graph edges, apply a recommendation, or resolve a finding.

## Verification

Run the domain and persistence checks for scoring, graph bounds, deterministic simulation, recommendation ordering, report content, storage validation, and recovery:

```powershell
npm test
```

Run the TypeScript check and production compilation:

```powershell
npm run build
```

Run the browser workflow suite for navigation, shared edits and persistence, simulation-to-review context, downloads, keyboard access, mobile layout, and malformed-data recovery:

```powershell
npm run test:e2e
```

The browser suite uses installed Google Chrome through Playwright and exercises the local application. Its configuration starts a localhost server when needed. Browser availability is a test prerequisite; it is not required to install Playwright's browsers to use the application itself.

## Demo boundaries and planned capabilities

- **Discovery:** seed refresh only. No real scan, probe, DNS lookup, host connection, or cloud/endpoint collection.
- **Threat context:** illustrative historical references only. No live CVE feed, verified vulnerability applicability, or current CISA KEV membership.
- **Paths and simulation:** local graph calculations only. No exploit payloads, command execution, attacks, or data access against infrastructure.
- **Recommendations:** deterministic planning estimates. No claim of measured reduction or trained optimization.
- **Guardian Gate:** human-reviewed local records only. No firewall, account, endpoint, cloud, or other infrastructure changes.
- **AI agents:** planned/unavailable. Activity reflects real local demo actions and rules, not a language model or autonomous agent execution.
- **ML models:** untrained/planned. No training runs, invented metrics, deployed inference, or validated detection capability.
- **Integrations:** not configured. No secrets or API keys are required or included.
- **Product security:** no production authentication, authorization, multi-tenant isolation, compliance assurance, tamper-resistant audit logging, or security validation is claimed.

The application is a personal defensive product demonstration, not a production security control or a substitute for verification in an authorized environment.
