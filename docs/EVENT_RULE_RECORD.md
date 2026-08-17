# Official Event Rule Record

## Purpose and authority

This is a point-in-time evidence record for the QuietOps eligibility and provenance gate. It records official event data returned by the signed-in Devpost MCP session; it does not replace the [official rules page](https://agentsforhumans.devpost.com/rules), certify personal eligibility, or authorize implementation publication.

> A note on accuracy: this guide is a helper. The information on the Devpost website is the correct and accurate version — if there is ever any discrepancy between what you read here and what the website says, the website prevails.

## Snapshot identity

| Item | Value |
| --- | --- |
| Event | Agents for Humans Hackathon |
| Devpost ID / slug | `30317` / `agentsforhumans` |
| Current phase | `submissions_open` |
| Rules fetched | `2026-08-16T04:32:15Z` |
| Dates fetched | `2026-08-16T04:32:17Z` |
| Submission requirements fetched | `2026-08-16T04:32:19Z` |
| Data completeness | rules `complete`; dates `complete`; submission requirements `complete` |
| Reviewer | OpenAI Codex, using the signed-in Devpost MCP session |
| Repository baseline | `YongHwan2161/quietops` at `d3a3153866f06a0b9e7d2a37da6f583318538f1d` |

## Official schedule

| Milestone | Pacific Time | UTC | Korea Standard Time |
| --- | --- | --- | --- |
| Submission opens | 2026-08-10 09:00 PT | `2026-08-10T16:00:00Z` | 2026-08-11 01:00 KST |
| Submission closes | 2026-09-14 17:00 PT | `2026-09-15T00:00:00Z` | 2026-09-15 09:00 KST |
| Judging opens | 2026-09-15 09:00 PT | `2026-09-15T16:00:00Z` | 2026-09-16 01:00 KST |
| Judging closes | 2026-10-08 17:00 PT | `2026-10-09T00:00:00Z` | 2026-10-09 09:00 KST |
| Winners announced | Around 2026-10-14 14:00 PT | `2026-10-14T21:00:00Z` | Around 2026-10-15 06:00 KST |

The Devpost MCP reports the configured time zone as `Pacific Time (US & Canada)`.

## Eligibility record

The official eligibility summary states:

> Above legal age of majority in country of residence

- Teams are not required, and the MCP returned no minimum or maximum team size.
- All occupations are allowed; a company is not required.
- The excluded-country data returned by Devpost does not list `Korea Republic of`; it does list `Korea Democratic People's Republic of`.
- The participant previously acknowledged the rules and eligibility in local workflow state. This remains participant attestation, not independent certification of age, residence, employment, affiliation, or conflict-of-interest facts.

Decision: `PARTICIPANT_ATTESTED_NOT_INDEPENDENTLY_CERTIFIED`.

## New-work and prior-work rule

The official rule states:

> New Projects Only: Projects must be newly created during the Submission Period. Participants may use standard development tools, including frameworks, libraries, starter templates, and AI coding assistants, but must disclose any other pre-existing code or work incorporated into the Project. The work described and submitted must have been built during the Submission Period.

Current QuietOps assessment:

| Evidence | Decision | Boundary |
| --- | --- | --- |
| Reported local prototype creation date: 2026-08-15 | `TEMPORAL_WINDOW_PASS` | The reported date is after the official submission start. It is not yet bound to an immutable file manifest. |
| Local prototype bytes | `HOLD_PROVENANCE_PENDING` | No implementation byte may be published until the snapshot manifest and file-level ledger pass. |
| Earlier MortalOS, CockroachDB hackathon, and Continuum Memory Firewall implementation | `BLOCK` | General lessons only under the current plan; implementation code is outside the import scope. |
| Codex and AI assistance | `DISCLOSURE_REQUIRED` | AI assistance is allowed by the quoted rule but remains explicitly disclosed. |

The temporal comparison does not prove that every file was created during the submission period and does not authorize import.

## Third-party rule

The official rule states:

> Third Party Integrations: If a Project integrates any third-party SDK, APIs and/or data, Entrant must be authorized to use them in accordance with any terms and conditions or licensing requirements of the tool.

Decision: all packages, templates, snippets, APIs, datasets, images, and generated assets remain `HOLD_THIRD_PARTY_REVIEW_PENDING` until the inventory required by the provenance gate is complete.

## Submission obligations

| Obligation | Current status | Evidence or blocker |
| --- | --- | --- |
| New Strands Agents SDK project that performs real work end to end | `HOLD_IMPLEMENTATION_NOT_PUBLISHED` | Planning repository only. |
| Professional Agents track | `PLANNED` | QuietOps targets repetitive, judgment-heavy work for small software teams. |
| Public code repository | `PASS_BASELINE_ONLY` | Repository is public, but it does not yet contain the required implementation, assets, or setup instructions. |
| MIT or Apache license visible in repository About | `PASS` | GitHub detects the current MIT license. |
| README | `PASS_PLANNING_ONLY` | Present; runnable setup instructions remain pending. |
| Architecture diagram | `HOLD_REQUIRED` | Required upload; accepted formats include PDF, PPT/PPTX, PNG, and JPEG. |
| Public demo video, maximum five minutes | `HOLD_REQUIRED` | Devpost marks video as required. |
| AWS Builder ID | `HOLD_UNVERIFIED` | Required submission field; no value is recorded here. |
| Working-project testing access | `HOLD_REQUIRED` | No public working project or test build is claimed from this repository. |
| English submission materials or English translations | `HOLD_SUBMISSION_REVIEW` | Must be checked across description, video, testing instructions, and other submitted material. |
| Live demo | `NOT_REQUIRED` | Optional; it may be claimed only after direct live verification. |
| AgentCore deployment | `NOT_REQUIRED` | Optional technical-strengthening choice; no live proof exists. |

## Optional blog inconsistency

The official rules report that they were updated on 2026-08-12 to remove the `#AgentsforHumans` requirement from bonus blog items. The live optional submission field `27737` instead says: `MUST be on builder.aws. Please use #AgentsofFootball`.

Decision: `HOLD_OFFICIAL_CLARIFICATION`. This inconsistency affects only the optional blog path. QuietOps will omit the optional blog field unless a fresh official record or written organizer clarification resolves the wording.

## Gate decision

| Gate | Decision |
| --- | --- |
| Official event data available and complete | `PASS_SNAPSHOT_CURRENT` |
| Reported prototype date within submission window | `TEMPORAL_WINDOW_PASS` |
| Personal eligibility | `PARTICIPANT_ATTESTED_NOT_INDEPENDENTLY_CERTIFIED` |
| Implementation publication | `HOLD_PROVENANCE_PENDING` |
| Third-party publication | `HOLD_THIRD_PARTY_REVIEW_PENDING` |
| Optional blog | `HOLD_OFFICIAL_CLARIFICATION` |
| AWS, Bedrock, AgentCore, deployment, video, and Devpost submission claims | `HOLD_NOT_VERIFIED` |

This record satisfies the provenance gate's point-in-time event-rule evidence requirement only. It does not satisfy the immutable source snapshot, file-level provenance, third-party inventory, or final submission re-verification requirements.

## Refresh and invalidation

Refresh this record from the official Devpost MCP:

- immediately before reviewing any implementation import;
- after any rules, dates, announcements, or submission-field change;
- before freezing the final public repository and submission;
- after any organizer clarification affecting a recorded HOLD.

Any changed official byte or field invalidates the affected decision; preserve this snapshot and create a dated successor rather than silently rewriting the historical observation.
