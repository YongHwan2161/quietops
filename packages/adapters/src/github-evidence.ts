import { z } from "zod";

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_WEB_ORIGIN = "https://github.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export const QUIETOPS_GITHUB_TARGET = Object.freeze({
  repository: "YongHwan2161/quietops",
  ref: "main",
  requiredWorkflow: "Verify",
} as const);

export interface GitHubEvidenceTarget {
  readonly repository: string;
  readonly ref: string;
  readonly requiredWorkflow: string;
}

export interface GitHubEvidenceObservation {
  readonly evidenceId: string;
  readonly kind: "Source revision" | "CI status";
  readonly status: "Verified";
  readonly value: string;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
}

export interface GitHubCiEvidenceObservation extends GitHubEvidenceObservation {
  readonly kind: "CI status";
  readonly workflowName: string;
  readonly runId: number;
  readonly headSha: string;
  readonly completedAt: string;
}

export interface GitHubEvidenceBundle {
  readonly target: Readonly<GitHubEvidenceTarget>;
  readonly source: GitHubEvidenceObservation & {
    readonly kind: "Source revision";
  };
  readonly ci: GitHubCiEvidenceObservation;
  readonly externalMutations: 0;
}

export const GITHUB_EVIDENCE_ERROR_CODES = Object.freeze({
  targetNotAllowed: "GITHUB_TARGET_NOT_ALLOWED",
  timeout: "GITHUB_REQUEST_TIMEOUT",
  network: "GITHUB_NETWORK_FAILED",
  rateLimited: "GITHUB_RATE_LIMITED",
  notFound: "GITHUB_RESOURCE_NOT_FOUND",
  requestFailed: "GITHUB_REQUEST_FAILED",
  responseTooLarge: "GITHUB_RESPONSE_TOO_LARGE",
  responseInvalid: "GITHUB_RESPONSE_INVALID",
  workflowNotFound: "GITHUB_REQUIRED_WORKFLOW_NOT_FOUND",
} as const);

export type GitHubEvidenceErrorCode =
  (typeof GITHUB_EVIDENCE_ERROR_CODES)[keyof typeof GITHUB_EVIDENCE_ERROR_CODES];

export class GitHubEvidenceError extends Error {
  readonly code: GitHubEvidenceErrorCode;

  constructor(code: GitHubEvidenceErrorCode, message: string) {
    super(message);
    this.name = "GitHubEvidenceError";
    this.code = code;
  }
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CollectGitHubEvidenceOptions {
  readonly fetchImplementation?: FetchImplementation;
  readonly clock?: () => Date;
  readonly timeoutMs?: number;
}

const githubWebUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).origin === GITHUB_WEB_ORIGIN);

const commitResponseSchema = z.object({
  sha: z.string().regex(FULL_COMMIT_PATTERN),
  html_url: githubWebUrlSchema,
});

const workflowRunSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  head_branch: z.string().min(1),
  head_sha: z.string().regex(FULL_COMMIT_PATTERN),
  status: z.literal("completed"),
  conclusion: z.string().min(1),
  html_url: githubWebUrlSchema,
  updated_at: z.iso.datetime({ offset: true }),
});

const workflowRunsResponseSchema = z.object({
  workflow_runs: z.array(workflowRunSchema).max(100),
});

export async function collectGitHubSourceAndCiEvidence(
  target: GitHubEvidenceTarget,
  options: CollectGitHubEvidenceOptions = {},
): Promise<GitHubEvidenceBundle> {
  assertAllowedTarget(target);
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const repositoryPath = target.repository
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const ref = encodeURIComponent(target.ref);

  const commitJson = await getGitHubJson(
    `${GITHUB_API_ORIGIN}/repos/${repositoryPath}/commits/${ref}`,
    fetchImplementation,
    timeoutMs,
  );
  const commit = parseResponse(commitResponseSchema, commitJson);
  const runsUrl = new URL(
    `${GITHUB_API_ORIGIN}/repos/${repositoryPath}/actions/runs`,
  );
  runsUrl.searchParams.set("branch", target.ref);
  runsUrl.searchParams.set("head_sha", commit.sha);
  runsUrl.searchParams.set("status", "completed");
  runsUrl.searchParams.set("per_page", "100");

  const runsJson = await getGitHubJson(
    runsUrl.toString(),
    fetchImplementation,
    timeoutMs,
  );
  const runs = parseResponse(workflowRunsResponseSchema, runsJson);
  const requiredRun = [...runs.workflow_runs]
    .filter(
      (run) =>
        run.name === target.requiredWorkflow &&
        run.head_branch === target.ref &&
        run.head_sha === commit.sha,
    )
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];

  if (!requiredRun) {
    throw new GitHubEvidenceError(
      GITHUB_EVIDENCE_ERROR_CODES.workflowNotFound,
      `No completed ${target.requiredWorkflow} workflow run was found for ${commit.sha}.`,
    );
  }

  const fetchedAt = (options.clock ?? (() => new Date()))().toISOString();
  return Object.freeze({
    target: Object.freeze({ ...target }),
    source: Object.freeze({
      evidenceId: `github-commit:${commit.sha}`,
      kind: "Source revision",
      status: "Verified",
      value: commit.sha,
      sourceUrl: commit.html_url,
      fetchedAt,
    }),
    ci: Object.freeze({
      evidenceId: `github-actions-run:${requiredRun.id}`,
      kind: "CI status",
      status: "Verified",
      value: requiredRun.conclusion,
      sourceUrl: requiredRun.html_url,
      fetchedAt,
      workflowName: requiredRun.name,
      runId: requiredRun.id,
      headSha: requiredRun.head_sha,
      completedAt: requiredRun.updated_at,
    }),
    externalMutations: 0,
  });
}

function assertAllowedTarget(target: GitHubEvidenceTarget): void {
  if (
    target.repository !== QUIETOPS_GITHUB_TARGET.repository ||
    target.ref !== QUIETOPS_GITHUB_TARGET.ref ||
    target.requiredWorkflow !== QUIETOPS_GITHUB_TARGET.requiredWorkflow
  ) {
    throw new GitHubEvidenceError(
      GITHUB_EVIDENCE_ERROR_CODES.targetNotAllowed,
      "The requested GitHub evidence target is outside the QuietOps allowlist.",
    );
  }
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30_000
  ) {
    throw new RangeError("timeoutMs must be an integer between 100 and 30000.");
  }
  return timeoutMs;
}

async function getGitHubJson(
  url: string,
  fetchImplementation: FetchImplementation,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "quietops-read-only-evidence",
      },
      redirect: "error",
      signal: controller.signal,
    });
    assertSuccessfulResponse(response);
    const body = await readBoundedBody(response);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new GitHubEvidenceError(
        GITHUB_EVIDENCE_ERROR_CODES.responseInvalid,
        "The GitHub evidence response was not valid JSON.",
      );
    }
  } catch (error) {
    if (error instanceof GitHubEvidenceError) throw error;
    if (controller.signal.aborted) {
      throw new GitHubEvidenceError(
        GITHUB_EVIDENCE_ERROR_CODES.timeout,
        "The GitHub evidence request timed out.",
      );
    }
    throw new GitHubEvidenceError(
      GITHUB_EVIDENCE_ERROR_CODES.network,
      `The GitHub evidence request failed before a complete response was received: ${errorName(error)}.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function assertSuccessfulResponse(response: Response): void {
  if (response.ok) return;
  if (response.status === 403 || response.status === 429) {
    throw new GitHubEvidenceError(
      GITHUB_EVIDENCE_ERROR_CODES.rateLimited,
      `GitHub rejected the read-only evidence request with status ${response.status}.`,
    );
  }
  if (response.status === 404) {
    throw new GitHubEvidenceError(
      GITHUB_EVIDENCE_ERROR_CODES.notFound,
      "The allowlisted GitHub evidence resource was not found.",
    );
  }
  throw new GitHubEvidenceError(
    GITHUB_EVIDENCE_ERROR_CODES.requestFailed,
    `GitHub returned unexpected status ${response.status}.`,
  );
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = response.headers.get("Content-Length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_RESPONSE_BYTES
  ) {
    throw responseTooLargeError();
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
      throw responseTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function responseTooLargeError(): GitHubEvidenceError {
  return new GitHubEvidenceError(
    GITHUB_EVIDENCE_ERROR_CODES.responseTooLarge,
    "The GitHub evidence response exceeded the one-megabyte limit.",
  );
}

function parseResponse<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new GitHubEvidenceError(
      GITHUB_EVIDENCE_ERROR_CODES.responseInvalid,
      "The GitHub evidence response did not match the required schema.",
    );
  }
  return parsed.data;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
