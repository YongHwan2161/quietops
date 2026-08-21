# Stage 4B-1 Live GitHub Strands/Ledger Verification

This record covers one actual public GitHub → Strands tools → deterministic policy → append-only SQLite execution on 2026-08-22 KST. It proves that real source and CI evidence can cross the agent/application boundary with provider receipts intact. It does not prove deployment evidence, browser integration, background execution, live Bedrock, AgentCore, or a fully live release evaluation.

## Verified path

```text
one fixed public GitHub collection
  -> observe_source_revision Strands tool
  -> observe_ci_status Strands tool
  -> two-call scenario-specific budget
  -> deterministic policy sees missing deployment evidence
  -> Could not complete, no human decision
  -> evidence + provider receipts + policy + completion appended to SQLite
```

The two tools share one lazy collection promise. The adapter therefore makes one commit lookup and one workflow-runs lookup for the invocation, while both tool receipts bind to the same fetch time and commit.

## Live observation

Command: `npm run demo:github:ledger`

| Item                               | Observed value                                                |
| ---------------------------------- | ------------------------------------------------------------- |
| Result / mode                      | `PASS` / `strands-github-source-ci-ledger`                    |
| Remote source commit               | `294a5eb04e9667c797aa7a316d5896c84a4342a1`                    |
| Required CI run                    | `32468420217` / `success`                                     |
| Evidence fetched                   | `2026-08-21T15:35:25.177Z`                                    |
| Persisted evidence / tool receipts | `2` / `2`                                                     |
| Timeline events                    | `5`                                                           |
| Policy outcome                     | `Could not complete`                                          |
| Policy reason                      | `Required evidence is incomplete: missing Deployed revision.` |
| Allowed human decisions            | none                                                          |
| SQLite integrity                   | `ok`                                                          |
| External mutations                 | `0`                                                           |

The candidate uses `https://quietops.example.invalid/releases/live-github-source-ci` as an explicit non-routable placeholder. It is not a deployment claim. No deployment observation is synthesized, and the incomplete path cannot produce `Ready`.

## Focused verification

- Agent test: two registered tools, one shared collection, bound GitHub receipts, two-call budget, `Could not complete`, zero mutations.
- Application test: live source/CI observations and receipts persisted, file-backed ledger closed and reopened, same outcome and provider record IDs reconstructed.
- Existing fixture Ready/mismatch behavior and duplicate-evidence rejection remain unchanged.

## Remaining holds

- The current browser continues to seed and display credential-free fixtures.
- No real deployment-marker or isolated browser-evidence collector exists.
- No scheduled/background evaluation invokes the live path.
- The model path is still credential-free scripted; live Bedrock and AgentCore remain unverified.
- The observed remote commit predates the unpublished Stage 4B-1 bytes and is not successor CI evidence for this branch.
