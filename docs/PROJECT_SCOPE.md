# Project Scope

## Product statement

QuietOps is a planned Strands-powered release steward for solo developers and 2-10 person software teams. It will gather read-only release evidence, reconcile that evidence against explicit policy, and surface one human decision only when evidence is missing, stale, contradictory, or outside policy.

## Target users

- Solo developers and small teams without a dedicated release engineer.
- Maintainers and consultants who need to show that a deployed build matches reviewed source.
- Reviewers who need a portable, understandable release-evidence packet.

## Problem

Release readiness is scattered across source revisions, CI jobs, deployment dashboards, browser checks, and manual notes. A green CI badge alone does not prove that the reviewed revision is deployed or behaves as expected. Reconstructing this context costs expert attention and still leaves room for approving the wrong revision.

## P0 scope

- One repository, one web deployment, and one release policy.
- A release inbox, evaluation detail, decision card, and audit history.
- Read-only evidence collection for candidate identity, required checks, deployment identity, and browser behavior.
- A deterministic policy layer that remains authoritative over model narration.
- Credential-free Ready and mismatch demo scenarios that execute the real evaluation path.
- Append-only evidence, event, and decision records.
- A portable Markdown audit summary.
- Clear separation of observed facts, policy results, agent recommendation, and human authorization.

## Out of scope

- Autonomous deployment, rollback, merge, secret rotation, billing, or repository mutation.
- General-purpose DevOps chat or incident management.
- Multi-provider support, arbitrary shell access, unrestricted HTTP access, or multi-agent swarms.
- Claims of security certification, compromise detection, production safety, or correctness beyond collected evidence.
- AgentCore deployment, DynamoDB, notifications, analytics, and risk acceptance until P0 is verified.

## Golden-path demo

1. Run a candidate whose source, checks, deployed revision, and browser assertions agree.
2. QuietOps quietly produces a Ready recommendation and audit packet without requiring an approval click.
3. Run a second candidate whose deployed revision differs from the expected commit.
4. QuietOps refuses readiness and presents one expected-versus-observed decision card.
5. A human rejects or requests a re-check, and the timeline preserves the distinction between evidence, recommendation, and authority.

## P0 success criteria

- A reviewer can run both scenarios without private credentials.
- Required evidence can never be converted to Ready while failed, unknown, stale, or missing.
- At least three meaningful bounded tool calls are visible as safe telemetry.
- No external write occurs in the judge path.
- README, UI, architecture, demo, and audit export use the same outcome vocabulary and claim boundaries.
