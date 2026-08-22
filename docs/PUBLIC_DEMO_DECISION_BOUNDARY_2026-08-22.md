# QuietOps Public-Demo Decision Boundary — 2026-08-22

## Outcome

Stage 4C-1a closes the first public-hosting blocker locally. QuietOps now has two explicit decision modes while preserving one evidence model:

| Mode                | Evidence and lineage | Decision UI         | Valid decision POST         | Intended use                         |
| ------------------- | -------------------- | ------------------- | --------------------------- | ------------------------------------ |
| `local-interactive` | Visible              | Reject and Re-check | Existing bounded behavior   | Credential-free local judge workflow |
| `public-read-only`  | Visible              | No decision inputs  | `403 PUBLIC_DEMO_READ_ONLY` | Shared anonymous evidence demo       |

The server defaults to `local-interactive` for compatibility with the existing loopback demo. The browser itself defaults fail-closed and unlocks decisions only after the inbox response explicitly reports `local-interactive`.

## Preserved invariants

- Public mode does not call the application decision service after a valid request reaches the route boundary.
- A rejected public decision leaves the stored decision `null`, the timeline event count unchanged, and the inbox evaluation identities unchanged.
- Evidence, expected-versus-observed details, re-check lineage, and zero-mutation tool receipts remain judge-visible.
- The public browser explains that a human decision is required while stating that the shared view cannot change the record.
- The local interactive flow, including idempotent decisions and re-check lineage, remains unchanged.

## Verification receipt

- Focused server tests: four passed, including the public read-only no-mutation test.
- Server typecheck and browser JavaScript syntax: passed.
- Actual headed Chromium journey at `http://127.0.0.1:4174` with `QUIETOPS_DECISION_MODE=public-read-only`: refreshed successfully; evidence remained visible; no Reject/Re-check action controls were present.
- Browser console: zero errors and zero warnings.
- Full repository verification: formatting, all workspace typechecks, browser syntax, and 40 tests passed (10 adapters, 10 agent, 6 application, 8 contracts, 4 server, 2 storage).
- Dependency audit: zero known vulnerabilities. Changed-byte secret-pattern scan: zero matches.
- External mutations: zero. The server and browser were local; no Railway project, service, volume, domain, environment variable, build, or deployment was created.
- The final commit identity is recorded in the change report and Git history after the complete gate passes.

## Remaining Stage 4C-1 work

This is not hosting readiness or deployment evidence. Stages 4C-1b through 4C-1d subsequently closed explicit host/`PORT`, process-liveness, release-marker, and external database-path contracts locally. A real managed volume and deterministic production/Railway start configuration remain. Billing review and every Railway mutation remain separately gated.
