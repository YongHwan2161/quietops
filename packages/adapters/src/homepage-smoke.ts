const HOMEPAGE_PATH = "/";
const DEFAULT_TIMEOUT_MS = 8_000;
export const MAX_HOMEPAGE_SMOKE_BYTES = 256 * 1024;
const QUIETOPS_REPOSITORY = "YongHwan2161/quietops";

export const QUIETOPS_PRODUCT_MARKER =
  'data-quietops-product="release-steward"' as const;

export interface HomepageSmokeTarget {
  readonly repository: typeof QUIETOPS_REPOSITORY;
  readonly homepageUrl: string;
}

export interface HomepageSmokeObservation {
  readonly evidenceId: string;
  readonly kind: "Homepage smoke";
  readonly status: "Verified";
  readonly value: "healthy";
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly httpStatus: 200;
  readonly contentType: string;
  readonly bodyBytes: number;
  readonly productMarker: typeof QUIETOPS_PRODUCT_MARKER;
}

export interface HomepageSmokeBundle {
  readonly target: Readonly<HomepageSmokeTarget>;
  readonly smoke: HomepageSmokeObservation;
  readonly externalMutations: 0;
}

export const HOMEPAGE_SMOKE_ERROR_CODES = Object.freeze({
  targetNotAllowed: "HOMEPAGE_TARGET_NOT_ALLOWED",
  timeout: "HOMEPAGE_REQUEST_TIMEOUT",
  network: "HOMEPAGE_NETWORK_FAILED",
  redirect: "HOMEPAGE_REDIRECT_REJECTED",
  requestFailed: "HOMEPAGE_REQUEST_FAILED",
  responseTooLarge: "HOMEPAGE_RESPONSE_TOO_LARGE",
  nonHtml: "HOMEPAGE_RESPONSE_NOT_HTML",
  unhealthy: "HOMEPAGE_PRODUCT_MARKER_MISSING",
} as const);

export type HomepageSmokeErrorCode =
  (typeof HOMEPAGE_SMOKE_ERROR_CODES)[keyof typeof HOMEPAGE_SMOKE_ERROR_CODES];

export class HomepageSmokeError extends Error {
  readonly code: HomepageSmokeErrorCode;

  constructor(code: HomepageSmokeErrorCode, message: string) {
    super(message);
    this.name = "HomepageSmokeError";
    this.code = code;
  }
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CreateHomepageSmokeCollectorOptions {
  readonly fetchImplementation?: FetchImplementation;
  readonly clock?: () => Date;
  readonly timeoutMs?: number;
}

export function createHomepageSmokeCollector(
  allowlistedTarget: HomepageSmokeTarget,
  options: CreateHomepageSmokeCollectorOptions = {},
): () => Promise<HomepageSmokeBundle> {
  const target = normalizeAllowlistedTarget(allowlistedTarget);
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  return async (): Promise<HomepageSmokeBundle> => {
    const { body, bytes, contentType } = await getHomepage(
      target.homepageUrl,
      fetchImplementation,
      timeoutMs,
    );
    if (!body.includes(QUIETOPS_PRODUCT_MARKER)) {
      throw new HomepageSmokeError(
        HOMEPAGE_SMOKE_ERROR_CODES.unhealthy,
        "The homepage did not contain the stable QuietOps product marker.",
      );
    }
    const fetchedAt = (options.clock ?? (() => new Date()))().toISOString();

    return Object.freeze({
      target,
      smoke: Object.freeze({
        evidenceId: `homepage-smoke:${new URL(target.homepageUrl).hostname}:${fetchedAt}`,
        kind: "Homepage smoke",
        status: "Verified",
        value: "healthy",
        sourceUrl: target.homepageUrl,
        fetchedAt,
        httpStatus: 200,
        contentType,
        bodyBytes: bytes,
        productMarker: QUIETOPS_PRODUCT_MARKER,
      }),
      externalMutations: 0,
    });
  };
}

function normalizeAllowlistedTarget(
  target: HomepageSmokeTarget,
): Readonly<HomepageSmokeTarget> {
  let homepageUrl: URL;
  try {
    homepageUrl = new URL(target.homepageUrl);
  } catch {
    throw targetNotAllowedError();
  }

  if (
    target.repository !== QUIETOPS_REPOSITORY ||
    homepageUrl.protocol !== "https:" ||
    homepageUrl.username !== "" ||
    homepageUrl.password !== "" ||
    homepageUrl.port !== "" ||
    homepageUrl.pathname !== HOMEPAGE_PATH ||
    homepageUrl.search !== "" ||
    homepageUrl.hash !== ""
  ) {
    throw targetNotAllowedError();
  }

  return Object.freeze({
    repository: QUIETOPS_REPOSITORY,
    homepageUrl: homepageUrl.toString(),
  });
}

function targetNotAllowedError(): HomepageSmokeError {
  return new HomepageSmokeError(
    HOMEPAGE_SMOKE_ERROR_CODES.targetNotAllowed,
    `The homepage target must bind ${QUIETOPS_REPOSITORY} to one HTTPS / URL without credentials, a non-default port, query, or fragment.`,
  );
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 8_000
  ) {
    throw new RangeError("timeoutMs must be an integer between 100 and 8000.");
  }
  return timeoutMs;
}

async function getHomepage(
  homepageUrl: string,
  fetchImplementation: FetchImplementation,
  timeoutMs: number,
): Promise<{
  readonly body: string;
  readonly bytes: number;
  readonly contentType: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(homepageUrl, {
      method: "GET",
      headers: {
        Accept: "text/html",
        "User-Agent": "quietops-read-only-homepage-smoke",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400)
    ) {
      throw new HomepageSmokeError(
        HOMEPAGE_SMOKE_ERROR_CODES.redirect,
        "The homepage smoke request refused a redirect.",
      );
    }
    if (response.status !== 200) {
      throw new HomepageSmokeError(
        HOMEPAGE_SMOKE_ERROR_CODES.requestFailed,
        `The homepage returned unexpected status ${response.status}.`,
      );
    }
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!/^text\/html(?:\s*;|$)/i.test(contentType)) {
      throw new HomepageSmokeError(
        HOMEPAGE_SMOKE_ERROR_CODES.nonHtml,
        "The homepage response was not HTML.",
      );
    }
    return { ...(await readBoundedBody(response)), contentType };
  } catch (error) {
    if (error instanceof HomepageSmokeError) throw error;
    if (controller.signal.aborted) {
      throw new HomepageSmokeError(
        HOMEPAGE_SMOKE_ERROR_CODES.timeout,
        "The homepage smoke request timed out.",
      );
    }
    throw new HomepageSmokeError(
      HOMEPAGE_SMOKE_ERROR_CODES.network,
      `The homepage smoke request failed before a complete response was received: ${errorName(error)}.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(
  response: Response,
): Promise<{ readonly body: string; readonly bytes: number }> {
  const contentLength = response.headers.get("Content-Length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_HOMEPAGE_SMOKE_BYTES
  ) {
    throw responseTooLargeError();
  }
  if (response.body === null) return { body: "", bytes: 0 };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_HOMEPAGE_SMOKE_BYTES) {
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
    return {
      body: new TextDecoder("utf-8", { fatal: true }).decode(body),
      bytes: totalBytes,
    };
  } catch {
    throw new HomepageSmokeError(
      HOMEPAGE_SMOKE_ERROR_CODES.nonHtml,
      "The homepage response was not valid UTF-8 HTML.",
    );
  }
}

function responseTooLargeError(): HomepageSmokeError {
  return new HomepageSmokeError(
    HOMEPAGE_SMOKE_ERROR_CODES.responseTooLarge,
    "The homepage response exceeded the 256-kilobyte limit.",
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
