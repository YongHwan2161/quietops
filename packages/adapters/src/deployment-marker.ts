import { z } from "zod";

const DEPLOYMENT_MARKER_PATH = "/.well-known/quietops-release.json";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64_000;
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const QUIETOPS_REPOSITORY = "YongHwan2161/quietops";

export interface DeploymentEvidenceTarget {
  readonly repository: typeof QUIETOPS_REPOSITORY;
  readonly markerUrl: string;
}

export interface DeploymentRevisionObservation {
  readonly evidenceId: string;
  readonly kind: "Deployed revision";
  readonly status: "Verified";
  readonly value: string;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
}

export interface DeploymentEvidenceBundle {
  readonly target: Readonly<DeploymentEvidenceTarget>;
  readonly deployment: DeploymentRevisionObservation;
  readonly externalMutations: 0;
}

export const DEPLOYMENT_EVIDENCE_ERROR_CODES = Object.freeze({
  targetNotAllowed: "DEPLOYMENT_TARGET_NOT_ALLOWED",
  timeout: "DEPLOYMENT_REQUEST_TIMEOUT",
  network: "DEPLOYMENT_NETWORK_FAILED",
  notFound: "DEPLOYMENT_MARKER_NOT_FOUND",
  requestFailed: "DEPLOYMENT_REQUEST_FAILED",
  responseTooLarge: "DEPLOYMENT_RESPONSE_TOO_LARGE",
  responseInvalid: "DEPLOYMENT_RESPONSE_INVALID",
} as const);

export type DeploymentEvidenceErrorCode =
  (typeof DEPLOYMENT_EVIDENCE_ERROR_CODES)[keyof typeof DEPLOYMENT_EVIDENCE_ERROR_CODES];

export class DeploymentEvidenceError extends Error {
  readonly code: DeploymentEvidenceErrorCode;

  constructor(code: DeploymentEvidenceErrorCode, message: string) {
    super(message);
    this.name = "DeploymentEvidenceError";
    this.code = code;
  }
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CreateDeploymentRevisionCollectorOptions {
  readonly fetchImplementation?: FetchImplementation;
  readonly clock?: () => Date;
  readonly timeoutMs?: number;
}

const markerSchema = z
  .object({
    schemaVersion: z.literal("1"),
    repository: z.literal(QUIETOPS_REPOSITORY),
    commit: z.string().regex(FULL_COMMIT_PATTERN),
  })
  .strict();

export function createDeploymentRevisionCollector(
  allowlistedTarget: DeploymentEvidenceTarget,
  options: CreateDeploymentRevisionCollectorOptions = {},
): () => Promise<DeploymentEvidenceBundle> {
  const target = normalizeAllowlistedTarget(allowlistedTarget);
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  return async (): Promise<DeploymentEvidenceBundle> => {
    const markerJson = await getDeploymentMarkerJson(
      target.markerUrl,
      fetchImplementation,
      timeoutMs,
    );
    const marker = parseMarker(markerJson);
    const fetchedAt = (options.clock ?? (() => new Date()))().toISOString();

    return Object.freeze({
      target,
      deployment: Object.freeze({
        evidenceId: `deployment-marker:${marker.commit}`,
        kind: "Deployed revision",
        status: "Verified",
        value: marker.commit,
        sourceUrl: target.markerUrl,
        fetchedAt,
      }),
      externalMutations: 0,
    });
  };
}

function normalizeAllowlistedTarget(
  target: DeploymentEvidenceTarget,
): Readonly<DeploymentEvidenceTarget> {
  let markerUrl: URL;
  try {
    markerUrl = new URL(target.markerUrl);
  } catch {
    throw targetNotAllowedError();
  }

  if (
    target.repository !== QUIETOPS_REPOSITORY ||
    markerUrl.protocol !== "https:" ||
    markerUrl.username !== "" ||
    markerUrl.password !== "" ||
    markerUrl.port !== "" ||
    markerUrl.pathname !== DEPLOYMENT_MARKER_PATH ||
    markerUrl.search !== "" ||
    markerUrl.hash !== ""
  ) {
    throw targetNotAllowedError();
  }

  return Object.freeze({
    repository: QUIETOPS_REPOSITORY,
    markerUrl: markerUrl.toString(),
  });
}

function targetNotAllowedError(): DeploymentEvidenceError {
  return new DeploymentEvidenceError(
    DEPLOYMENT_EVIDENCE_ERROR_CODES.targetNotAllowed,
    `The deployment target must bind ${QUIETOPS_REPOSITORY} to one HTTPS ${DEPLOYMENT_MARKER_PATH} URL without credentials, a non-default port, query, or fragment.`,
  );
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

async function getDeploymentMarkerJson(
  markerUrl: string,
  fetchImplementation: FetchImplementation,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(markerUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "quietops-read-only-evidence",
      },
      redirect: "error",
      signal: controller.signal,
    });
    assertSuccessfulResponse(response);
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw responseInvalidError();
    }
    const body = await readBoundedBody(response);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw responseInvalidError();
    }
  } catch (error) {
    if (error instanceof DeploymentEvidenceError) throw error;
    if (controller.signal.aborted) {
      throw new DeploymentEvidenceError(
        DEPLOYMENT_EVIDENCE_ERROR_CODES.timeout,
        "The deployment marker request timed out.",
      );
    }
    throw new DeploymentEvidenceError(
      DEPLOYMENT_EVIDENCE_ERROR_CODES.network,
      `The deployment marker request failed before a complete response was received: ${errorName(error)}.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function assertSuccessfulResponse(response: Response): void {
  if (response.ok) return;
  if (response.status === 404) {
    throw new DeploymentEvidenceError(
      DEPLOYMENT_EVIDENCE_ERROR_CODES.notFound,
      "The allowlisted deployment marker was not found.",
    );
  }
  throw new DeploymentEvidenceError(
    DEPLOYMENT_EVIDENCE_ERROR_CODES.requestFailed,
    `The deployment marker returned unexpected status ${response.status}.`,
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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw responseInvalidError();
  }
}

function parseMarker(value: unknown): z.output<typeof markerSchema> {
  const parsed = markerSchema.safeParse(value);
  if (!parsed.success) throw responseInvalidError();
  return parsed.data;
}

function responseTooLargeError(): DeploymentEvidenceError {
  return new DeploymentEvidenceError(
    DEPLOYMENT_EVIDENCE_ERROR_CODES.responseTooLarge,
    "The deployment marker response exceeded the 64-kilobyte limit.",
  );
}

function responseInvalidError(): DeploymentEvidenceError {
  return new DeploymentEvidenceError(
    DEPLOYMENT_EVIDENCE_ERROR_CODES.responseInvalid,
    "The deployment marker response did not match the required schema.",
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
