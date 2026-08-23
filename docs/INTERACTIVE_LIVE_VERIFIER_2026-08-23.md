# Interactive Live Release Verifier — 2026-08-23

## Outcome

`LOCAL_BROWSER_LIVE_PROVIDER_PASS_EXTERNAL_DEPLOY_HOLD` — the successor implements the first user-operable QuietOps path from a browser action through actual public evidence orchestration and persisted replay. Public availability remains unclaimed until successor CI, merge, Railway deployment, and public-domain verification pass.

## User journey

1. A visitor selects `Verify this live release`.
2. The server accepts no browser-selected repository, branch, commit, or URL.
3. One Strands invocation calls exactly three allowlisted read-only tools: GitHub source, required GitHub Actions workflow, and the construction-bound Railway release marker.
4. Deterministic policy compares the observed source commit, CI result, and deployed commit.
5. The append-only SQLite ledger stores the observations, provider URLs and record IDs, fetch times, evidence IDs, policy result, and `externalMutations: 0`.
6. A repeat request for the same configured deployment commit replays the original evaluation rather than appending a duplicate.

## Focused verification

- Agent: 11 tests pass, including one shared GitHub collection plus one deployment collection through three bounded Strands tools.
- Application: 8 tests pass, including file-backed persistence, ledger reopen, same-key replay with one runner call, and rejection of a foreign deployment-marker receipt.
- Server: 15 tests pass, including the public live-verification endpoint, disabled-without-release fail-closed behavior, browser copy, decision lock, and strict marker behavior.
- Source, CI, and deployment fixture values must match before `Ready`; all tool receipts and the completed evaluation record require `externalMutations: 0`.

These focused tests inject provider responses. They prove composition, policy, persistence, and HTTP/browser contracts, not current public-provider availability.

## Full and live verification

- `npm run verify`: 54 tests pass across adapters, agent, application, contracts, server, and storage; format, type, and browser syntax checks also pass.
- The built Fastify endpoint performed an actual fixed-target read through the new application path and returned HTTP `200` with `scenario: live-release-verification`, `outcome: Ready`, and `externalMutations: 0`.
- The three observed values all resolved to `1edbded139c0e7e8ec6e90e9d8f8ee57353ea41a`:
  - source receipt `github-commit:1edbded139c0e7e8ec6e90e9d8f8ee57353ea41a`;
  - CI receipt `github-actions-run:32562992913`, value `success`;
  - deployment receipt `deployment-marker:1edbded139c0e7e8ec6e90e9d8f8ee57353ea41a`.
- A second endpoint request returned the same evaluation ID with `replayed: true`; the first returned `replayed: false`.
- A headed Chromium journey at desktop and `390 × 844` mobile viewports selected the visible action, rendered one live `Ready` receipt separately from preserved examples, exposed all three provider links, kept the live count at one after replay, and produced zero console errors or warnings.

This is live-provider proof executed by a local build against the predecessor public deployment. It is not proof that the successor UI or endpoint is already deployed publicly.

## Safety boundary

- Fixed repository: `YongHwan2161/quietops`
- Fixed branch: `main`
- Fixed required workflow: `Verify`
- Fixed marker: `https://quietops-production.up.railway.app/.well-known/quietops-release.json`
- Browser-selected targets: none
- Provider writes, deployment, rollback, merge, shell, or secret authority: none
- Shared public human decisions: still rejected

## Remaining gate

Pass successor CI, merge, update the exact deployed release identity, verify Railway health and marker responses, then run and replay the public action. Any mismatch or missing evidence must prevent a `Ready` claim.
