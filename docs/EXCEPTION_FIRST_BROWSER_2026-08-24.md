# Exception-first browser verification

## Outcome

QuietOps now opens as a product for a release owner, not as its own engineering
report. The first screen explains the autonomy boundary, selects the one run that
needs judgment, and keeps evidence identifiers behind an expandable audit layer.
No browser control starts the showcased run.

The public walkthrough is backed by two immutable event histories created through
the release-run ledger:

| History | Observations | Policy waits | Human prompts | External write attempts | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Quiet completion | 1 | 0 | 0 | 0 | `COMPLETED` |
| Healthy delayed release | 2 | 1 | 1 | 0 | `AWAITING_DECISION` |

The delayed history includes one measured five-second wait, eight bounded provider
receipts, the missing owner context, and the exact consequences of
`WAIT_AND_RECHECK` and `ESCALATE_INCIDENT`. These values are API projections of
persisted events; the browser does not calculate or invent them.

## Product and API contract

- `GET /api/release-runs` returns attention-ranked run summaries, evidence mode,
  activity state, and the four autonomy counters.
- `GET /api/release-runs/:runId` returns the human-readable timeline, decision
  facts and consequences, same-run action result, and provider receipts.
- Active runs poll every two seconds. Identical responses do not replace the DOM,
  so focus and the selected run remain stable.
- Preserved demonstrations are labeled and excluded from worker claims. They
  remain read-only even when an operator token is configured.
- A live pending run renders one password input only when the server says the
  viewer may decide. The token is read into memory for one authenticated POST,
  immediately cleared from the input, and never sent in the body or stored by the
  browser.
- After authorization the same run renders a decision receipt and its resumed
  state; it does not leave the choice controls visible.
- Legacy inbox, evaluation-detail, and live-verification APIs remain available to
  existing clients, but the product page does not call or foreground them.

## Verification evidence

Focused automated verification passed locally:

- Server: 27 tests, including public projections, missing-run denial, preserved
  decision denial, live one-POST authorization, and same-run `WAITING` resume.
- Storage: 12 tests, including bounded newest-first listing and proof that a newer
  preserved run cannot win a worker claim over a live run.
- Browser source: `node --check`; no `localStorage`, `sessionStorage`, legacy
  start control, or browser-selected target.
- Full repository gate: `npm run verify` passed formatting, all workspace
  typechecks, browser syntax, and 145 tests across six workspaces.

Playwright drove headed Chromium against the local Fastify server and verified:

1. the attention run is selected first with `2 / 1 / 1 / 0` API/DOM counts;
2. the terminal history switches to `1 / 0 / 0 / 0` and stops polling;
3. the decision question, both consequences, read-only public boundary, timeline,
   and expandable receipts are keyboard-visible semantic controls;
4. polling an unchanged active run preserves the control reference and permits a
   later click without a refresh race;
5. a separate live fixture accepts one in-memory owner token, clears the input,
   records `WAIT_AND_RECHECK`, and refreshes the same
   `browser-live-delayed-release` run from `AWAITING_DECISION` to `WAITING` with
   external write attempts still `0`;
6. the final live decision/resume session emitted no console log, warning, or error;
7. the product remains usable at a 390-pixel viewport.

Local screenshots are intentionally kept in the ignored `output/playwright`
verification directory until the Devpost artifact gate:

| View | SHA-256 | Bytes |
| --- | --- | ---: |
| Quiet terminal | `E21272ADE2ACFC5FC0C4A0C49010B608AE3C0ED1900FFFB34F3E90CFFFB99261` | 451,717 |
| Human boundary | `7CCB9DEC8FCDB8DB1405C62A2D9E8CF0AE1E5105644E62D77EBE3AFA938E421F` | 581,042 |
| 390 px human boundary | `5239662BFD7F4F547C9D4DFBE1937370B62570CD5ED4F82B77B9DE1E6B37F003` | 457,452 |

## Boundaries

This is local and preserved evidence, not a claim about the currently deployed
Railway site. No webhook, Bedrock credential, operator secret, GitHub issue
credential, deployment, or provider write was created. Item 10 retains all live
AWS, deployment, webhook, secret-installation, and worker-enable gates; Item 11
retains the first GitHub write gate.
