# QuietOps Hosting Target Decision — 2026-08-22

## Decision

`SELECT_RAILWAY_PREPARE_ONLY` — prepare QuietOps for one Railway-hosted public demo, but do not create a project, service, volume, domain, environment variable, or deployment until the public-write boundary and billing impact are explicitly approved.

This is a target-selection record, not deployment evidence.

## Why Railway is the minimum path

- QuietOps is an npm shared monorepo. Railway documents root-level builds and service-specific start commands for shared JavaScript monorepos.
- QuietOps currently stores its append-only ledger in SQLite. Railway volumes provide a mounted persistent directory, including support for application-relative paths under `/app`.
- The Railway CLI is already installed and authenticated on this workstation. A read-only check found one unrelated project, no QuietOps project, and no project linked to this checkout.
- Railway can supply a public service domain after creation. That exact generated HTTPS origin can then become the deployment collector's construction-bound allowlist.
- Railway's current public pricing page lists a limited trial/free path and a Hobby plan with a $5 minimum usage commitment. The current account plan and remaining credits were not inspected, so the real charge remains unknown until the billing screen is reviewed.

Official references: [Railway shared monorepos](https://docs.railway.com/deployments/monorepo), [Railway volumes](https://docs.railway.com/volumes), and [Railway pricing](https://railway.com/pricing).

## Rejected as the minimum path

### AWS App Runner

AWS has closed App Runner to new customers. Existing customers may continue, but current account eligibility was not checked. App Runner also documents its container filesystem as ephemeral and says applications should not assume file persistence across requests, which conflicts with QuietOps' current SQLite ledger without a storage redesign.

Official references: [App Runner availability change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html) and [App Runner runtime storage](https://docs.aws.amazon.com/apprunner/latest/dg/develop.html).

### AWS Lightsail Container Service

Lightsail provides a managed HTTPS public container endpoint and is viable after containerization, but it adds image packaging and AWS resource lifecycle work. AWS currently lists the smallest container service at $0.0094/hour, up to $7/month, with charges continuing while the service is running or disabled until deletion. It is a reasonable fallback when AWS-native hosting matters more than the shortest demo path.

Official references: [Lightsail container services](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-container-services.html) and [Lightsail container FAQ](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-containers.html).

## Deployment blockers discovered

The current server must not be published as-is:

1. Closed locally by Stage 4C-1b: only `127.0.0.1` and `0.0.0.0` are accepted, the platform `PORT` is validated, ambiguous dual-port configuration fails closed, and non-loopback binding requires `public-read-only`.
2. Closed locally by Stages 4C-1b and 4C-1c: `GET /health` provides no-store process liveness, and a strictly configured `/.well-known/quietops-release.json` returns the exact release commit. No hosted marker exists yet.
3. Closed locally by Stage 4C-1a: explicit `public-read-only` mode keeps evidence visible, removes decision controls, and rejects otherwise valid decision writes without changing the ledger. Authentication for a future shared interactive workflow remains out of scope.
4. Closed locally by Stage 4C-1d: a public bind now requires an explicit absolute `QUIETOPS_DB_PATH` outside the repository, suitable for a mount such as `/data/quietops.sqlite`. No Railway volume has been created or verified.
5. Closed locally by Stage 4C-1e: root `npm start` delegates to the server workspace and executes only prebuilt output. Railway configuration is still absent.

The public-write boundary was the decisive first blocker and is now closed locally. The remaining items still prevent deployment readiness.

## Next local increment

Stage 4C-1 should make the server hosting-ready without deploying it:

- use the verified explicit host and platform `PORT` contract (`COMPLETE_LOCAL`, Stage 4C-1b);
- use the verified credential-free no-store liveness check (`COMPLETE_LOCAL`, Stage 4C-1b);
- use the verified no-store release marker bound to a full commit (`COMPLETE_LOCAL`, Stage 4C-1c);
- use the verified `public-read-only` decision policy so an anonymous visitor cannot corrupt the shared judge state (`COMPLETE_LOCAL`, Stage 4C-1a);
- use the verified external SQLite path contract (`COMPLETE_LOCAL`, Stage 4C-1d), then separately create and verify the actual persistent volume only after approval;
- use the deterministic production start command (`COMPLETE_LOCAL`, Stage 4C-1e), then add a narrowly reviewed Railway configuration without creating resources;
- run the complete local/browser verification with zero external mutations.

Only after Stage 4C-1 passes should the user review the Railway plan/credit screen and authorize creating billable/public resources.

## External mutation gate

Not performed:

- Railway project or service creation;
- repository connection or source authorization;
- volume, environment variable, or public domain creation;
- build, deployment, restart, or generated marker observation;
- billing-plan change or usage commitment.
