# Stage 4B-0 Live GitHub Evidence Verification

This record covers the first direct provider observation made by the bounded `@quietops/adapters` package on 2026-08-22 KST. It proves a public read-only GitHub source/CI boundary. It does not prove that the Strands agent, application service, ledger, or browser currently consumes live evidence.

Successor note: Stage 4B-1 later connected this adapter to a separate Strands/application/ledger path. This record remains the preserved Stage 4B-0 observation; see [Stage 4B-1 Live GitHub Strands/Ledger Verification](LIVE_GITHUB_STRANDS_LEDGER_2026-08-22.md).

## Implemented boundary

```text
fixed allowlist: YongHwan2161/quietops + main + Verify
  -> GET public commit for main
  -> validate exact 40-character commit and source URL
  -> GET completed Actions runs bound to branch and commit
  -> select exact Verify workflow
  -> validate run identity, conclusion, URL, and timestamps
  -> emit source and CI observations with externalMutations: 0
```

The adapter uses the fixed `https://api.github.com` origin and no authorization header. It rejects redirects, targets outside the exact allowlist, timeouts, non-success HTTP responses, rate limits, responses larger than one megabyte, malformed payloads, and a missing completed `Verify` workflow.

The implementation follows GitHub's official [Get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit) and [List workflow runs for a repository](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository) REST endpoint contracts.

## Live observation

Command: `npm run demo:github`

| Item                      | Observed value                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Result                    | `PASS`                                                                                     |
| Mode                      | `github-public-read-only`                                                                  |
| Repository / ref          | `YongHwan2161/quietops` / `main`                                                           |
| Source commit             | `294a5eb04e9667c797aa7a316d5896c84a4342a1`                                                 |
| Source receipt            | `https://github.com/YongHwan2161/quietops/commit/294a5eb04e9667c797aa7a316d5896c84a4342a1` |
| Required workflow         | `Verify`                                                                                   |
| Workflow run / conclusion | `32468420217` / `success`                                                                  |
| Workflow receipt          | `https://github.com/YongHwan2161/quietops/actions/runs/32468420217`                        |
| Workflow completed        | `2026-08-21T09:33:29Z`                                                                     |
| Evidence fetched          | `2026-08-21T15:07:42.852Z`                                                                 |
| External mutations        | `0`                                                                                        |

The observed remote commit predates the local Stage 4B-0 implementation branch. This record therefore proves that the new local adapter can read and bind the accepted remote `main` and its CI; it is not successor CI evidence for the unpublished adapter bytes.

## Focused verification

Six adapter tests pass for:

- exact commit and required workflow selection;
- preservation of a completed failed CI result as non-passing evidence;
- missing required workflow failure;
- pre-network rejection of a non-allowlisted repository;
- stable invalid-payload and rate-limit errors;
- response-size and whole-response timeout enforcement.

## Remaining holds

- The GitHub observations are not registered as Strands tools.
- The application service, SQLite ledger, API, and browser still execute the credential-free fixture scenarios.
- Deployment-marker and isolated browser-evidence collectors are not implemented.
- Background scheduling, live Bedrock, AgentCore, hosted deployment, and Devpost actions remain separate gates.
