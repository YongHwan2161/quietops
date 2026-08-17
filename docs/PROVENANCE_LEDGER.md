# Eligibility and Provenance Gate

## Purpose

This gate prevents implementation files, executable configuration, generated evidence, and imported assets from entering the public repository until their origin, eligibility, authorship, license, and disclosure obligations are reviewable.

The gate does not determine competition eligibility by itself. Current official event rules remain authoritative and must be checked at the time of any import and again before submission.

## Decision vocabulary

- `PASS`: the item may be published within the reviewed scope.
- `HOLD`: publication is prohibited until named evidence or review is complete.
- `BLOCK`: the item must not be imported under the current project plan.

## Current authority

| Source class | Current decision | Evidence and boundary |
| --- | --- | --- |
| Initial planning baseline | `PASS` | Commit `98cc17c78adb98a8e185654125f8e31725619694`; eight documentation/license files; planning-only; AI assistance disclosed; MIT licensed. |
| Local QuietOps prototype created 2026-08-15 | `HOLD` | The reported date is within the submission period recorded in the [official event rule record](EVENT_RULE_RECORD.md), but the prototype is not present in the initial public commit. Import still requires a source snapshot manifest, file-level classification, license review, and disclosure decision. |
| MortalOS, CockroachDB hackathon, and Continuum Memory Firewall implementation code | `BLOCK` | General lessons may inform design, but implementation code is outside the QuietOps import scope unless this plan is explicitly revised and separately reviewed. |
| Third-party packages, templates, snippets, datasets, images, and generated assets | `HOLD` | Each item requires an exact version or source reference, license/terms review, attribution decision, and evidence of permitted use. |

## Required evidence before implementation publication

1. **[Current event-rule record](EVENT_RULE_RECORD.md)**
   - authoritative URL;
   - verification timestamp and reviewer;
   - eligibility window and new-work or prior-work requirements;
   - required disclosure, repository, license, and submission conditions;
   - unresolved ambiguity and any organizer response.
2. **Immutable source snapshot manifest**
   - source label and capture timestamp;
   - file count and total bytes;
   - per-file relative path, size, and SHA-256;
   - aggregate manifest SHA-256;
   - explicit secret and private-data exclusions.
3. **File-level provenance decisions**
   - one ledger row for every file proposed for publication;
   - origin, authoring date, source reference, authorship, AI assistance, license, transformation, and disclosure;
   - reviewer, decision, evidence reference, and decision timestamp.
4. **Third-party inventory**
   - package, template, asset, API, and data source versions;
   - license or terms URL and compatibility decision;
   - required attribution and redistribution conditions.
5. **Public-history consistency check**
   - repository history, README, disclosures, architecture, demo, and submission text describe the same origin boundary;
   - no local PASS is represented as live AWS, Bedrock, AgentCore, deployment, or submission proof.

## File-level ledger template

| Candidate path | Origin class | Created or acquired | Source reference | Author or provider | AI-assisted | License or terms | Transformation | Decision | Reviewer and time | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _Populate before publication_ |  |  |  |  |  |  |  | `HOLD` |  |  |

## Gate algorithm

1. Default every candidate item to `HOLD`.
2. Reject secrets, private data, unverifiable sources, incompatible licenses, and out-of-scope prior-project implementation as `BLOCK`.
3. Grant `PASS` only when the current event-rule record, snapshot manifest, file-level row, license decision, and required disclosure all exist and agree.
4. Bind the approved file set to an exact tree or commit SHA before publication.
5. If any approved byte changes, invalidate the prior decision for that file and review the successor bytes as a new candidate.

## Stage 0 exit criteria

Stage 0 may authorize implementation publication only when:

- the [official event rule record](EVENT_RULE_RECORD.md) is current and has no unresolved eligibility blocker for the proposed publication set;
- every proposed file is represented in the immutable manifest and file-level ledger;
- every proposed file is `PASS`, with zero `HOLD` or `BLOCK` files in the publication set;
- third-party obligations and AI/prior-work disclosures are complete;
- the exact approved tree or commit SHA is recorded before push.

Until all criteria pass, planning-document updates may continue, but implementation publication remains `HOLD`.
