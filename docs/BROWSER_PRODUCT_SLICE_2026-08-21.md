# Stage 4A-2 Browser Product Slice Verification

This record covers the credential-free, loopback-only HTTP/browser slice verified on 2026-08-21. It does not claim hosted availability, live provider collection, live AWS/Bedrock execution, AgentCore deployment, or Devpost submission.

## Verified product path

```text
empty file-backed SQLite ledger
  -> atomic Ready + deployed-SHA-mismatch Strands evaluations
  -> mismatch-first release inbox
  -> expected-versus-observed evidence and bounded tool receipts
  -> Re-check requested through the validated HTTP API
  -> append-only parent decision receipt + child evaluation
  -> browser refresh and server restart reconstruct the same lineage
```

The browser consumes only same-origin server projections. It does not import the fixture objects, calculate a policy result, access SQLite, or retain an authoritative decision only in client state.

## HTTP boundary

The implemented API is deliberately limited to:

- `GET /api/inbox`
- `GET /api/evaluations/:evaluationId`
- `POST /api/evaluations/:evaluationId/decisions`

Decision requests require a bounded `Idempotency-Key`, an allowed decision, and a non-empty actor. Unknown evaluations, malformed requests, attempts to decide Ready, and idempotency conflicts fail closed with stable non-2xx responses. The server binds the demo to `127.0.0.1`, returns restrictive browser security headers, and does not expose a destructive reset route.

## Verification evidence

| Check                   | Result                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clean install           | `npm ci` installed the locked tree; npm reported `0 vulnerabilities`.                                                                                              |
| Repository gate         | `npm run verify` PASS; 27/27 tests: Agent 9, Application 5, Contracts 8, Server 3, Storage 2.                                                                      |
| HTTP integration        | PASS for mismatch-first projections, static browser delivery, strict validation, unauthorized decisions, and not-found handling.                                   |
| Atomic demo seed        | PASS; failure of either scenario leaves the previously empty ledger with zero evaluations.                                                                         |
| Idempotency and restart | PASS; duplicate Re-check returned the original receipt, one child was created, and three inbox records survived reopening the same database.                       |
| Desktop browser         | Chrome through Playwright CLI at 1440 x 1100; inbox/detail/action/lineage journey PASS, console errors 0, warnings 0.                                              |
| Mobile browser          | Chrome viewport at 390 x 844; responsive master-detail journey rendered without horizontal content loss, console errors 0, warnings 0.                             |
| Judge contrast          | `npm run demo:judge` PASS for Ready then deployed-SHA mismatch through Strands Agents SDK 1.13.0.                                                                  |
| Ledger demo             | `npm run demo:ledger` PASS; SQLite integrity `ok`, idempotency replay true, evaluations 2.                                                                         |
| External mutations      | `0` in Ready, mismatch, ledger, HTTP, and browser paths.                                                                                                           |
| Dependency audit        | npm audit vulnerabilities 0; installed dependency manifests had 0 missing licenses and only 0BSD, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, or MIT identifiers. |
| Secret-pattern scan     | `SECRET_SCAN_MATCHES=0` for common AWS, GitHub, OpenAI, and private-key credential forms outside generated/vendor directories.                                     |

Fastify `5.12.1` is the only new direct locked runtime dependency; its transitive tree is also locked and covered by the audit and license inventory above. `@playwright/cli` `0.1.18` was invoked ephemerally for real-browser verification and is not present in `package.json` or `package-lock.json`. Generated SQLite files, Playwright session state, dependency inventories, and screenshots are ignored local evidence rather than published product bytes.

## Remaining holds

- Background scheduling, progress events, bounded retries, interruption recovery, and resumable SSE are not implemented.
- Authentication, audit export, browser evidence collection, and live GitHub/CI/deployment collectors are not implemented.
- Live Bedrock, AgentCore, hosted deployment, Docker judge packaging, architecture assets, public video, and Devpost changes remain separately gated.
- Local credential-free fixtures prove the product interaction and persistence boundary, not live-provider behavior or production readiness.
