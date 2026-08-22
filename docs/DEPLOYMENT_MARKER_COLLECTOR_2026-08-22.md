# Stage 4B-2 Deployment-Marker Collector Verification

This record covers the locally verified deployment-marker contract added on 2026-08-22 KST. It proves a bounded read-only adapter shape; it does not prove that QuietOps is hosted, that a real deployment marker exists, or that deployment evidence currently reaches Strands, SQLite, or the browser.

## Bound request

Trusted application code creates the collector with one target:

```text
repository: YongHwan2161/quietops
marker URL: https://<selected-host>/.well-known/quietops-release.json
```

The returned collector accepts no invocation arguments. It performs exactly one unauthenticated `GET`, rejects redirects, and cannot be redirected by model or tool input. The URL must use HTTPS on the default port and cannot contain credentials, query parameters, or a fragment.

## Marker contract

```json
{
  "schemaVersion": "1",
  "repository": "YongHwan2161/quietops",
  "commit": "<40 lowercase hexadecimal characters>"
}
```

Unknown fields, a different repository, an abbreviated commit, a non-JSON response, a body larger than 64 kilobytes, a missing marker, or a timeout fail closed. Success returns one verified `Deployed revision` observation with the exact marker URL, full commit, fetch time, stable evidence ID, and `externalMutations: 0`.

## Verification

- Success request and observation contract: PASS.
- Construction-time target rejection: PASS for HTTP, credentials, non-default port, alternate path, query, and fragment.
- Strict marker rejection: PASS for repository drift, abbreviated commit, unknown field, and wrong content type.
- Missing, oversized, and timed-out response mapping: PASS.
- Focused adapter suite: 10/10 tests PASS.

## Holds

- The example host in tests is synthetic and was not contacted.
- No real deployment marker URL has been selected or called.
- Stage 4C-1c now serves the matching marker contract locally when an exact commit is configured, but this does not create a real HTTPS target.
- The collector is not registered as a Strands tool and its observation is not persisted or displayed.
- The existing live GitHub evaluation must continue returning `Could not complete` until real deployment evidence is integrated and verified.
