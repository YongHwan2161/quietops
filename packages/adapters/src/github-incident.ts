import { createHash } from "node:crypto";

import { z } from "zod";

const GITHUB_API_VERSION = "2026-03-10";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const QUIETOPS_GITHUB_INCIDENT_TARGET = Object.freeze({
  repository: "YongHwan2161/quietops",
  endpoint:
    "https://api.github.com/repos/YongHwan2161/quietops/issues" as const,
});

export interface GitHubIncidentEvidenceLink {
  readonly evidenceId: string;
  readonly fetchedAt: string;
  readonly sourceUrl: string;
}

export interface GitHubIncidentContext {
  readonly runId: string;
  readonly candidateCommit: string;
  readonly decisionId: string;
  readonly authorizedAt: string;
  readonly observationCount: number;
  readonly measuredWaitMs: number;
  readonly evidence: {
    readonly source: GitHubIncidentEvidenceLink;
    readonly ci: GitHubIncidentEvidenceLink;
    readonly deployment: GitHubIncidentEvidenceLink;
    readonly homepageSmoke: GitHubIncidentEvidenceLink;
  };
}

export interface GitHubIncidentPlan {
  readonly repository: "YongHwan2161/quietops";
  readonly endpoint: typeof QUIETOPS_GITHUB_INCIDENT_TARGET.endpoint;
  readonly title: string;
  readonly body: string;
  readonly requestFingerprint: string;
  readonly context: GitHubIncidentContext;
}

export type GitHubIncidentActionResult =
  | Readonly<{
      status: "CONFIRMED";
      providerRecordId: string;
      providerUrl: string;
      responseDigest: string;
      externalWriteAttempts: 1;
    }>
  | Readonly<{
      status: "REJECTED" | "UNCERTAIN";
      providerRecordId: null;
      providerUrl: null;
      responseDigest: string | null;
      externalWriteAttempts: 1;
    }>;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ExecuteGitHubIncidentOptions {
  readonly token: string;
  readonly fetchImplementation?: FetchImplementation;
  readonly timeoutMs?: number;
}

const issueResponseSchema = z.object({
  number: z.number().int().positive().safe(),
  html_url: z.string().url(),
});

export function buildGitHubIncidentPlan(
  context: Readonly<GitHubIncidentContext>,
): Readonly<GitHubIncidentPlan> {
  const normalized = normalizeContext(context);
  const title = `[QuietOps] Delayed release ${normalized.candidateCommit.slice(0, 12)} requires incident follow-up`;
  const body = [
    "## QuietOps release incident",
    "",
    "QuietOps exhausted its normal observation budget and received explicit release-owner authorization for one incident attempt.",
    "",
    `QuietOps-Run: ${normalized.runId}`,
    `Candidate: ${normalized.candidateCommit}`,
    `Decision: ${normalized.decisionId}`,
    `Authorized at: ${normalized.authorizedAt}`,
    `Observations: ${normalized.observationCount}`,
    `Measured wait: ${normalized.measuredWaitMs} ms`,
    "",
    "### Evidence",
    evidenceLine("Source", normalized.evidence.source),
    evidenceLine("Required CI", normalized.evidence.ci),
    evidenceLine("Deployment", normalized.evidence.deployment),
    evidenceLine("Homepage smoke", normalized.evidence.homepageSmoke),
    "",
    "This issue was created by one authorized QuietOps attempt. Ambiguous provider outcomes are never retried automatically.",
  ].join("\n");
  const requestFingerprint = sha256(
    canonicalJson({
      body,
      endpoint: QUIETOPS_GITHUB_INCIDENT_TARGET.endpoint,
      method: "POST",
      repository: QUIETOPS_GITHUB_INCIDENT_TARGET.repository,
      title,
    }),
  );
  return deepFreeze({
    repository: QUIETOPS_GITHUB_INCIDENT_TARGET.repository,
    endpoint: QUIETOPS_GITHUB_INCIDENT_TARGET.endpoint,
    title,
    body,
    requestFingerprint,
    context: normalized,
  });
}

export async function executeGitHubIncident(
  plan: Readonly<GitHubIncidentPlan>,
  options: Readonly<ExecuteGitHubIncidentOptions>,
): Promise<GitHubIncidentActionResult> {
  assertExactPlan(plan);
  const token = normalizeGitHubIssueToken(options.token);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImplementation(plan.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "quietops-release-steward",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: JSON.stringify({ title: plan.title, body: plan.body }),
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    return uncertain(null);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 400 && response.status <= 499) {
    await discardBody(response);
    return rejected(statusDigest(response.status));
  }
  if (response.status !== 201) {
    await discardBody(response);
    return uncertain(statusDigest(response.status));
  }

  let rawBody: string;
  try {
    rawBody = await readBoundedBody(response);
  } catch {
    return uncertain(statusDigest(201));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return uncertain(sha256(rawBody));
  }
  const issue = issueResponseSchema.safeParse(parsed);
  if (!issue.success) return uncertain(sha256(rawBody));
  const expectedUrl = `https://github.com/YongHwan2161/quietops/issues/${issue.data.number}`;
  if (issue.data.html_url !== expectedUrl) {
    return uncertain(sha256(rawBody));
  }
  return Object.freeze({
    status: "CONFIRMED",
    providerRecordId: String(issue.data.number),
    providerUrl: issue.data.html_url,
    responseDigest: sha256(rawBody),
    externalWriteAttempts: 1,
  });
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Classification is intentionally based on the bounded status code only.
  }
}

export function normalizeGitHubIssueToken(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    value.trim() !== value ||
    /\s|[\u0000-\u001f\u007f]/.test(value) ||
    bytes < 20 ||
    bytes > 512
  ) {
    throw new Error(
      "GitHub issue token must be 20-512 bytes without whitespace or control characters.",
    );
  }
  return value;
}

function normalizeContext(
  context: Readonly<GitHubIncidentContext>,
): GitHubIncidentContext {
  assertIdentifier(context.runId, "run ID");
  assertIdentifier(context.decisionId, "decision ID");
  if (!COMMIT_PATTERN.test(context.candidateCommit)) {
    throw new Error("Invalid incident candidate commit.");
  }
  assertUtcTimestamp(context.authorizedAt, "authorization time");
  assertPositiveInteger(context.observationCount, "observation count");
  assertNonNegativeInteger(context.measuredWaitMs, "measured wait");
  const source = normalizeEvidence(
    context.evidence.source,
    "source",
    "github.com",
  );
  const ci = normalizeEvidence(context.evidence.ci, "CI", "github.com");
  const deployment = normalizeEvidence(
    context.evidence.deployment,
    "deployment",
    "quietops-production.up.railway.app",
  );
  const homepageSmoke = normalizeEvidence(
    context.evidence.homepageSmoke,
    "homepage smoke",
    "quietops-production.up.railway.app",
  );
  if (
    source.evidenceId !== `github-commit:${context.candidateCommit}` ||
    source.sourceUrl !==
      `https://github.com/YongHwan2161/quietops/commit/${context.candidateCommit}`
  ) {
    throw new Error("Source incident evidence is not bound to the candidate.");
  }
  const ciId = /^github-actions-run:([1-9]\d*)$/.exec(ci.evidenceId)?.[1];
  if (
    !ciId ||
    ci.sourceUrl !==
      `https://github.com/YongHwan2161/quietops/actions/runs/${ciId}`
  ) {
    throw new Error(
      "CI incident evidence is not bound to the fixed repository.",
    );
  }
  if (
    deployment.sourceUrl !==
    "https://quietops-production.up.railway.app/.well-known/quietops-release.json"
  ) {
    throw new Error("Deployment incident evidence is not the fixed marker.");
  }
  if (
    homepageSmoke.sourceUrl !== "https://quietops-production.up.railway.app/"
  ) {
    throw new Error("Homepage incident evidence is not the fixed smoke route.");
  }
  return deepFreeze({
    runId: context.runId,
    candidateCommit: context.candidateCommit,
    decisionId: context.decisionId,
    authorizedAt: context.authorizedAt,
    observationCount: context.observationCount,
    measuredWaitMs: context.measuredWaitMs,
    evidence: {
      source,
      ci,
      deployment,
      homepageSmoke,
    },
  });
}

function normalizeEvidence(
  evidence: Readonly<GitHubIncidentEvidenceLink>,
  label: string,
  expectedHost: string,
): GitHubIncidentEvidenceLink {
  assertIdentifier(evidence.evidenceId, `${label} evidence ID`);
  assertUtcTimestamp(evidence.fetchedAt, `${label} fetch time`);
  let url: URL;
  try {
    url = new URL(evidence.sourceUrl);
  } catch {
    throw new Error(`Invalid ${label} evidence URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHost ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`Invalid ${label} evidence URL.`);
  }
  return Object.freeze({
    evidenceId: evidence.evidenceId,
    fetchedAt: evidence.fetchedAt,
    sourceUrl: url.toString(),
  });
}

function assertExactPlan(plan: Readonly<GitHubIncidentPlan>): void {
  const rebuilt = buildGitHubIncidentPlan(plan.context);
  if (
    !SHA256_PATTERN.test(plan.requestFingerprint) ||
    canonicalJson(plan) !== canonicalJson(rebuilt)
  ) {
    throw new Error(
      "GitHub incident plan does not match its immutable context.",
    );
  }
}

function evidenceLine(
  label: string,
  evidence: Readonly<GitHubIncidentEvidenceLink>,
): string {
  return `- ${label}: [${evidence.evidenceId}](${evidence.sourceUrl}) — fetched ${evidence.fetchedAt}`;
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) {
    throw new Error("GitHub issue timeout must be 100-30000 ms.");
  }
  return value;
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = response.headers.get("Content-Length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_RESPONSE_BYTES
  ) {
    throw new Error("GitHub issue response is too large.");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("GitHub issue response is too large.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf8", { fatal: true }).decode(body);
}

function rejected(responseDigest: string): GitHubIncidentActionResult {
  return Object.freeze({
    status: "REJECTED",
    providerRecordId: null,
    providerUrl: null,
    responseDigest,
    externalWriteAttempts: 1,
  });
}

function uncertain(responseDigest: string | null): GitHubIncidentActionResult {
  return Object.freeze({
    status: "UNCERTAIN",
    providerRecordId: null,
    providerUrl: null,
    responseDigest,
    externalWriteAttempts: 1,
  });
}

function statusDigest(status: number): string {
  return sha256(`github-issue-response-status:${status}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) throw new Error(`Invalid ${label}.`);
}

function assertUtcTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  try {
    if (new Date(value).toISOString() !== value) throw new Error("invalid");
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}.`);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
