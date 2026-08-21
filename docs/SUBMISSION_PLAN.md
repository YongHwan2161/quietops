# Submission Plan

## Target

- Event: Agents for Humans Hackathon on Devpost.
- Intended track: Professional Agents.
- Product story: a release steward that performs repetitive evidence work and interrupts a human only for a genuine release decision.

This is a planning snapshot dated 2026-08-16. The official event page and rules prevail if any requirement, date, or eligibility condition changes.

## Planned submission package

- Public source repository with visible MIT license.
- README with product purpose, architecture, installation, judge path, testing, and claim boundaries.
- Architecture diagram and narrative.
- Public demo video of no more than five minutes.
- Credential-free Ready and mismatch judge path.
- Strands usage explanation and, if actually completed, separately labeled live validation evidence.
- AI/Codex assistance, conceptual references to earlier projects, and actual third-party or incorporated material disclosed with clear boundaries.
- Optional hosted demo or AgentCore evidence only after live verification.

## Five-minute story

1. State the small-team release problem and the human attention cost.
2. Run the Ready scenario and show bounded tool work resolving without a decision request.
3. Run the mismatch scenario and show QuietOps refusing readiness.
4. Show the expected-versus-observed decision card and one human action.
5. Show preserved history and a portable audit packet.
6. Close with the nonclaim: QuietOps recommends release readiness from collected evidence; it does not deploy or guarantee security.

## Readiness checks before submission

- Re-verify official deadline, eligibility, team rules, track, judging criteria, and required fields.
- Confirm the repository and video are public and accessible in a signed-out browser.
- Confirm README instructions work from a clean environment.
- Confirm license detection and About metadata.
- Confirm implementation work is traceable to QuietOps repository history and any incorporated pre-existing bytes are explicitly disclosed.
- Confirm conceptual references are not represented as copied implementation.
- Confirm every third-party dependency and asset has an exact source or version and compatible license or terms.
- Confirm demo, repository, architecture, and submission text describe the same behavior.
- Confirm every live-cloud, performance, security, and zero-mutation claim has current evidence.
- Freeze exact commit, image digest, receipt hashes, URLs, and final text before submission.
- Perform no post-deadline change unless current official rules explicitly permit it.

## Current holds

- The credential-free Ready/mismatch judge path, append-only evaluation/application spine, and a loopback-only HTTP/browser decision workflow are implemented. SSE, background orchestration, browser/live-provider collectors, export, authentication, Docker packaging, architecture assets, and public video remain incomplete.
- No deployment, live Bedrock/AgentCore proof, public video, or Devpost submission has been performed from this repository.
