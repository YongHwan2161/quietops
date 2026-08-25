# Live Bedrock-backed Strands validation

## Outcome

The first external gate in checklist Item 10 passed. One bounded local command
used the real Strands `BedrockModel` with an active Amazon Bedrock inference
profile, called the three fixture-backed read-only evidence tools exactly once
each, and left deterministic policy authoritative. The process exited `0` and
reported `externalMutations: 0`.

This proves the Bedrock-backed agent/tool loop. It does not claim that the
observed fixture revisions came from live GitHub or Railway, that the successor
is deployed, or that a webhook, worker, operator credential, or incident action
is enabled.

## Execution receipt

| Field | Observed value |
| --- | --- |
| Command | `npm run demo:mismatch:bedrock` |
| Window | `2026-08-25T14:03:53.3093785Z` to `2026-08-25T14:03:58.1343509Z` (`23:03:53` to `23:03:58` KST) |
| AWS region | `ap-southeast-1` |
| Inference profile | `apac.amazon.nova-micro-v1:0` (`ACTIVE`, system-defined) |
| Runtime | `@strands-agents/sdk` `1.13.0` |
| Model mode | `bedrock-live` |
| Scenario | `deployed-sha-mismatch` |
| Source / expected revision | `9854d5cc21840c15652fea3e032b1711a940d57a` |
| Fixture deployed revision | `311238afe40b1b7d7d28c58eca40ccbd18aae892` |
| Policy result | `Needs decision` |
| Allowed decisions | `Reject`, `Re-check requested` |
| Tool receipts | `3` total; one per allowlisted tool |
| External mutations reported by QuietOps | `0` |
| Process exit | `0` |

The model gathered and summarized all three observations, but explicitly left
release readiness to deterministic policy. Policy rejected a false `Ready`
because the fixture deployment revision did not match the expected source
revision.

## Bounded tool behavior

| Tool | Calls | Receipt mutation count |
| --- | ---: | ---: |
| `observe_source_revision` | 1 | 0 |
| `observe_ci_status` | 1 | 0 |
| `observe_deployed_revision` | 1 | 0 |

`EvidenceToolBudget` rejects a duplicate call, a fourth call, or any tool outside
that allowlist. The live model cannot replace or override the deterministic
release policy.

## Source lineage

The command ran from Item 9 branch commit
`e52bfe73481fb305c7d114f43695eb296879833f`. Before the invocation, the Bedrock
command, model construction, release slice, tools, tool budget, and package
manifests had no diff from then-current `main`
`9565ef6deef2e952d05c9a72e3f2254da70ba27e`. Item 9 subsequently merged as
`8b78a9085b770145ae4c4caf163734a1879ad7aa`, without changing those files, and
post-merge Verify run
[`32901671266`](https://github.com/YongHwan2161/quietops/actions/runs/32901671266)
passed.

Representative Git blob identities on merged `main`:

| File | Blob |
| --- | --- |
| `packages/agent/src/bedrock.ts` | `bc25fa5079eaf9c4a8756155e116e8fdebbaa44b` |
| `packages/agent/src/bedrock-cli.ts` | `32c2eedf567f3d159fafec25cea4abfd2e9c8a55` |
| `packages/agent/src/run-mismatch.ts` | `fe6ebe5bc89d06ebcdcd2955263592f4a17cd580` |
| `packages/agent/src/tool-budget.ts` | `208b0340ea264d784a314d8a1a50a28e0ebbaa32` |
| `packages/agent/src/tools.ts` | `0ae6545024412a4c964269b67cfb4504bf672c2f` |

## Credential and mutation boundaries

- AWS authentication used the CLI default credential chain through the local
  `continuum-hackathon` profile. QuietOps did not read or print credential bytes.
- The refreshed local session currently represents the AWS root identity. It is
  acceptable only for this bounded participant-attested local proof and must
  never be copied into Railway, committed, or used as the production worker
  identity. Deployment requires a separate least-privilege credential design.
- Refreshing the AWS login session and setting its default region were explicit
  authentication/configuration effects outside QuietOps' provider-mutation
  counter. The Bedrock agent tools themselves reported zero provider mutations.
- The command may incur ordinary Bedrock inference usage. No cost amount is
  claimed without a settled billing record.
- No deployment, secret installation, webhook creation, worker enablement,
  GitHub issue write, or Devpost submission occurred in this validation.

## Remaining Item 10 holds

`HOLD_AWS_AUTH` and `HOLD_MERGE` are closed by the live receipt and merged Item 9
lineage. Item 10 remains unchecked and is now stopped at `HOLD_DEPLOY`. The
currently public Railway site still serves the predecessor implementation; a
backward-compatible successor deployment with the worker disabled requires a
separate exact deployment authorization and post-deploy verification.
