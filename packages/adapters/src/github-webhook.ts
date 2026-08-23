import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_GITHUB_WEBHOOK_BODY_BYTES = 256 * 1_024;

export const QUIETOPS_GITHUB_WEBHOOK_TARGET = Object.freeze({
  repository: "YongHwan2161/quietops",
  ref: "refs/heads/main",
});

export type GitHubWebhookRejectionReason =
  | "unsupported-event"
  | "foreign-repository"
  | "foreign-ref"
  | "deleted-push"
  | "invalid-after";

export type GitHubPushWebhookInspection =
  | Readonly<{
      accepted: true;
      deliveryId: string;
      candidateCommit: string;
    }>
  | Readonly<{
      accepted: false;
      deliveryId: string;
      reason: GitHubWebhookRejectionReason;
    }>;

export interface InspectGitHubPushWebhookInput {
  readonly rawBody: Uint8Array;
  readonly secret: string;
  readonly signature: string | undefined;
  readonly event: string | undefined;
  readonly deliveryId: string | undefined;
}

export type GitHubWebhookRequestErrorCode =
  | "GITHUB_WEBHOOK_BODY_TOO_LARGE"
  | "GITHUB_WEBHOOK_INVALID_DELIVERY"
  | "GITHUB_WEBHOOK_INVALID_JSON"
  | "GITHUB_WEBHOOK_INVALID_PAYLOAD";

export class GitHubWebhookAuthenticationError extends Error {
  readonly code = "GITHUB_WEBHOOK_INVALID_SIGNATURE" as const;

  constructor() {
    super("The GitHub webhook signature is invalid.");
    this.name = "GitHubWebhookAuthenticationError";
  }
}

export class GitHubWebhookRequestError extends Error {
  constructor(
    readonly code: GitHubWebhookRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitHubWebhookRequestError";
  }
}

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;
const DELIVERY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export function verifyGitHubWebhookSignature(
  rawBody: Uint8Array,
  secret: string,
  signature: string | undefined,
): boolean {
  if (secret.length === 0) {
    throw new Error("GitHub webhook verification requires a secret.");
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const match = signature?.match(SIGNATURE_PATTERN) ?? null;
  const supplied = match
    ? Buffer.from(match[1]!, "hex")
    : Buffer.alloc(expected.length);
  const equal = timingSafeEqual(expected, supplied);
  return match !== null && equal;
}

export function inspectGitHubPushWebhook(
  input: InspectGitHubPushWebhookInput,
): GitHubPushWebhookInspection {
  if (input.rawBody.byteLength > MAX_GITHUB_WEBHOOK_BODY_BYTES) {
    throw new GitHubWebhookRequestError(
      "GITHUB_WEBHOOK_BODY_TOO_LARGE",
      "The GitHub webhook body exceeds 256 KiB.",
    );
  }

  if (
    !verifyGitHubWebhookSignature(input.rawBody, input.secret, input.signature)
  ) {
    throw new GitHubWebhookAuthenticationError();
  }

  if (
    input.deliveryId === undefined ||
    !DELIVERY_PATTERN.test(input.deliveryId)
  ) {
    throw new GitHubWebhookRequestError(
      "GITHUB_WEBHOOK_INVALID_DELIVERY",
      "The GitHub delivery identifier is missing or invalid.",
    );
  }

  if (input.event !== "push") {
    return Object.freeze({
      accepted: false,
      deliveryId: input.deliveryId,
      reason: "unsupported-event",
    });
  }

  const payload = parsePayload(input.rawBody);
  if (payload.repository !== QUIETOPS_GITHUB_WEBHOOK_TARGET.repository) {
    return Object.freeze({
      accepted: false,
      deliveryId: input.deliveryId,
      reason: "foreign-repository",
    });
  }
  if (payload.ref !== QUIETOPS_GITHUB_WEBHOOK_TARGET.ref) {
    return Object.freeze({
      accepted: false,
      deliveryId: input.deliveryId,
      reason: "foreign-ref",
    });
  }
  if (payload.deleted) {
    return Object.freeze({
      accepted: false,
      deliveryId: input.deliveryId,
      reason: "deleted-push",
    });
  }
  if (!COMMIT_PATTERN.test(payload.after)) {
    return Object.freeze({
      accepted: false,
      deliveryId: input.deliveryId,
      reason: "invalid-after",
    });
  }

  return Object.freeze({
    accepted: true,
    deliveryId: input.deliveryId,
    candidateCommit: payload.after,
  });
}

interface ParsedPushPayload {
  readonly repository: string;
  readonly ref: string;
  readonly after: string;
  readonly deleted: boolean;
}

function parsePayload(rawBody: Uint8Array): ParsedPushPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(UTF8_DECODER.decode(rawBody));
  } catch {
    throw new GitHubWebhookRequestError(
      "GITHUB_WEBHOOK_INVALID_JSON",
      "The authenticated GitHub webhook body is not valid UTF-8 JSON.",
    );
  }

  if (!isRecord(parsed) || !isRecord(parsed.repository)) {
    throw invalidPayload();
  }
  const repository = parsed.repository.full_name;
  const ref = parsed.ref;
  const after = parsed.after;
  const deleted = parsed.deleted;
  if (
    typeof repository !== "string" ||
    typeof ref !== "string" ||
    typeof after !== "string" ||
    typeof deleted !== "boolean"
  ) {
    throw invalidPayload();
  }
  return Object.freeze({ repository, ref, after, deleted });
}

function invalidPayload(): GitHubWebhookRequestError {
  return new GitHubWebhookRequestError(
    "GITHUB_WEBHOOK_INVALID_PAYLOAD",
    "The authenticated GitHub push payload is incomplete.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
