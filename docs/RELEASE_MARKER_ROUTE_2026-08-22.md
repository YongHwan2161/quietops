# QuietOps Release-Marker Route Boundary — 2026-08-22

## Outcome

Stage 4C-1c closes the local producer side of the Stage 4B-2 deployment-marker contract. QuietOps can serve one exact release identity without allowing a request, model, browser, or local default to choose it.

## Configuration and response

`QUIETOPS_RELEASE_COMMIT` must be exactly 40 lowercase hexadecimal characters. A `0.0.0.0` bind now requires this setting in addition to `public-read-only`; validation finishes before database construction or network listening.

When configured, `GET /.well-known/quietops-release.json` returns:

```json
{
  "schemaVersion": "1",
  "repository": "YongHwan2161/quietops",
  "commit": "<the configured full commit>"
}
```

The response is JSON under `Cache-Control: no-store`. Without the setting, the route is not registered and returns the ordinary 404 boundary. Invalid, abbreviated, uppercase, or oversized commit values fail closed.

## Verification receipt

- Focused server typecheck: passed.
- Focused server tests: 11 passed, including missing-marker 404, exact response/header validation, invalid direct server configuration, runtime commit validation, and public-bind marker enforcement.
- Full repository verification: formatting, all workspace typechecks, browser syntax, and 47 tests passed (10 adapters, 10 agent, 6 application, 8 contracts, 11 server, 2 storage).
- Dependency audit: zero known vulnerabilities. Changed-byte secret-pattern scan: zero matches.
- The post-commit exact-HEAD process probe is recorded after the local commit is created.
- External mutations: zero. No HTTPS target, Railway resource, deployment, collector call, or evaluation integration was created.

## Remaining Stage 4C-1 work

The local producer and collector schemas now match, but no real HTTPS target exists and the collector is not wired into Strands, SQLite, or the browser. Stage 4C-1d subsequently added the external SQLite path contract and local restart proof, and Stage 4C-1e added the deterministic local production-start command. A real managed volume and Railway configuration remain before any external resource request.
