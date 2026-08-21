# Judging Context Refresh — 2026-08-20

## Purpose and authority

This focused successor records the current official judging context used to choose the next QuietOps increment. It was returned by the signed-in Devpost MCP session for the Agents for Humans Hackathon. It supplements rather than rewrites the historical [event rule record](EVENT_RULE_RECORD.md), and the [official event](https://agentsforhumans.devpost.com) remains authoritative.

Implementation update: Stage 4A-2 subsequently delivered and locally verified the first HTTP/browser decision workflow. Stage 4B-0 added a bounded public-GitHub source/CI adapter, and Stage 4B-1 then ran that collection through Strands and the append-only ledger while refusing `Ready` without deployment evidence. See [Stage 4A-2 Browser Product Slice Verification](BROWSER_PRODUCT_SLICE_2026-08-21.md), [Stage 4B-0 Live GitHub Evidence Verification](LIVE_GITHUB_EVIDENCE_2026-08-22.md), [Stage 4B-1 Live GitHub Strands/Ledger Verification](LIVE_GITHUB_STRANDS_LEDGER_2026-08-22.md), and [Problem Selection Rationale](PROBLEM_SELECTION_RATIONALE_2026-08-22.md). The judging criteria below remain the point-in-time basis for those increments.

## Snapshot identity

| Item                     | Value                                                 |
| ------------------------ | ----------------------------------------------------- |
| Event                    | Agents for Humans Hackathon                           |
| Devpost ID / slug        | `30317` / `agentsforhumans`                           |
| Current phase            | `submissions_open`                                    |
| Overview fetched         | `2026-08-20T12:23:32Z`                                |
| Judging criteria fetched | `2026-08-20T12:23:41Z`                                |
| Dates fetched            | `2026-08-20T12:23:43Z`                                |
| Announcements fetched    | `2026-08-20T12:23:44Z`                                |
| Data completeness        | complete for all four calls                           |
| Reviewer                 | OpenAI Codex, using the signed-in Devpost MCP session |

## Official judging criteria and current QuietOps boundary

| Criterion                    | Official emphasis                                                                                                          | Current QuietOps evidence or gap                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technological Implementation | Thorough, skillful, genuine, non-trivial Strands Agents use; a live demo or AgentCore deployment can strengthen the score. | Real bounded Strands loops, deterministic policy, and credential-free tests exist. Live Bedrock and AgentCore remain unverified.                  |
| Design                       | A complete, coherent product experience rather than only a technical proof of concept.                                     | The persistent application spine now exists, but the API and browser product experience do not. A static fixture viewer would not close this gap. |
| Potential Impact             | A credible and specific real problem, real audience, and demonstrated fit.                                                 | The small-team release problem and target user are documented; demonstrated user outcome and time-saving evidence remain incomplete.              |
| Creativity & Originality     | A creative, non-obvious Strands use and genuine problem-space understanding.                                               | Evidence-policy-authority separation is the differentiated idea; the eventual demo must make it visible rather than bury it in logs.              |
| Presentation                 | A clear end-to-end working video and an understandable problem, user, and value pitch.                                     | The judge CLI is reproducible; browser experience, architecture asset, and public video remain incomplete.                                        |

## Current strategy decision

The organizer's only current announcement recommends one workflow that works end to end, an early architecture sketch, and an early video storyboard. QuietOps will therefore build one real product path rather than a broad dashboard:

```text
background evaluation
  -> quiet Ready history or one mismatch interruption
  -> expected-versus-observed evidence
  -> Reject or Re-check requested
  -> preserved decision receipt and lineage
```

Stage 4A-1 implements the persistent application spine for that path. It intentionally does not claim that a browser exists. The next browser increment must consume these stored projections and make a real decision command rather than import fixture JSON or mutate client-only state.

## Deadline

The official submission deadline remains `2026-09-15T00:00:00Z`, which is 2026-09-15 09:00 KST. Refresh the official criteria, dates, announcements, rules, and submission requirements again before the final repository and submission freeze.
