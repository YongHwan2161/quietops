import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  GitHubWebhookAuthenticationError,
  GitHubWebhookRequestError,
  MAX_GITHUB_WEBHOOK_BODY_BYTES,
  inspectGitHubPushWebhook,
} from "@quietops/adapters";
import {
  DecisionNotAllowedError,
  EvaluationAlreadyResolvedError,
  EvaluationNotFoundError,
  EvaluationService,
  ReleaseRunService,
  ReleaseRunWorker,
  type EvaluationServiceOptions,
  type ReleaseRunWorkerOptions,
  type ReleaseRunWorkerShutdownResult,
} from "@quietops/application";
import { resolvePolicyProfile } from "@quietops/contracts";
import {
  IdempotencyConflictError,
  SQLiteEvaluationLedger,
  SQLiteReleaseRunLedger,
} from "@quietops/storage";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
} from "fastify";

const PUBLIC_FILES = Object.freeze({
  "/": Object.freeze({
    name: "index.html",
    contentType: "text/html; charset=utf-8",
  }),
  "/app.js": Object.freeze({
    name: "app.js",
    contentType: "text/javascript; charset=utf-8",
  }),
  "/styles.css": Object.freeze({
    name: "styles.css",
    contentType: "text/css; charset=utf-8",
  }),
  "/favicon.svg": Object.freeze({
    name: "favicon.svg",
    contentType: "image/svg+xml",
  }),
});

const PUBLIC_DIRECTORY = new URL("../../public/", import.meta.url);
const RELEASE_MARKER_PATH = "/.well-known/quietops-release.json";
const QUIETOPS_REPOSITORY = "YongHwan2161/quietops";

interface EvaluationParams {
  readonly evaluationId: string;
}

interface DecisionHeaders {
  readonly "idempotency-key": string;
}

interface DecisionBody {
  readonly decision: "Reject" | "Re-check requested";
  readonly actor: string;
  readonly note?: string;
}

export interface GitHubWebhookServerOptions {
  readonly secret: string;
  readonly now?: () => Date;
}

export interface CreateQuietOpsServerOptions {
  readonly databasePath?: string;
  readonly seedDemo?: boolean;
  readonly evaluationServiceOptions?: EvaluationServiceOptions;
  readonly logger?: FastifyServerOptions["logger"];
  readonly decisionMode?: DecisionMode;
  readonly releaseCommit?: string;
  readonly githubWebhook?: GitHubWebhookServerOptions;
  readonly releaseWorker?: ReleaseWorkerServerOptions;
}

export interface ReleaseWorkerServerOptions extends Omit<
  ReleaseRunWorkerOptions,
  "service"
> {
  readonly onShutdown?: (
    result: Readonly<ReleaseRunWorkerShutdownResult>,
  ) => void;
}

export type DecisionMode = "local-interactive" | "public-read-only";

export async function createQuietOpsServer(
  options: CreateQuietOpsServerOptions = {},
): Promise<FastifyInstance> {
  const decisionMode = normalizeDecisionMode(options.decisionMode);
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  const githubWebhook = normalizeGitHubWebhook(options.githubWebhook);
  const ledger = new SQLiteEvaluationLedger(options.databasePath);
  const releaseRunLedger =
    githubWebhook || options.releaseWorker
      ? new SQLiteReleaseRunLedger(options.databasePath)
      : undefined;
  const releaseRunService = releaseRunLedger
    ? new ReleaseRunService(releaseRunLedger)
    : undefined;
  const service = new EvaluationService(
    ledger,
    options.evaluationServiceOptions,
  );
  const app = Fastify({
    bodyLimit: 16 * 1024,
    logger: options.logger ?? false,
    requestTimeout: 10_000,
    routerOptions: {
      maxParamLength: 128,
    },
    trustProxy: false,
  });
  const releaseWorker =
    options.releaseWorker && releaseRunService
      ? createReleaseWorker(releaseRunService, options.releaseWorker, (error) =>
          app.log.error({ err: error }, "Release worker tick failed"),
        )
      : undefined;

  app.addHook("onReady", () => {
    releaseWorker?.start();
  });

  app.addHook("onClose", async () => {
    if (releaseWorker) {
      const shutdown = await releaseWorker.stop();
      options.releaseWorker?.onShutdown?.(shutdown);
    }
    releaseRunLedger?.close();
    ledger.close();
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("Cache-Control", "no-store")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
      )
      .header("Cross-Origin-Opener-Policy", "same-origin")
      .header("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY");
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      sendError(
        reply,
        400,
        "INVALID_REQUEST",
        "The request did not match the API contract.",
      );
      return;
    }
    if (error instanceof GitHubWebhookAuthenticationError) {
      sendError(reply, 401, error.code, error.message);
      return;
    }
    if (error instanceof GitHubWebhookRequestError) {
      sendError(
        reply,
        error.code === "GITHUB_WEBHOOK_BODY_TOO_LARGE" ? 413 : 400,
        error.code,
        error.message,
      );
      return;
    }
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      const isWebhook = request.routeOptions.url === "/api/github/webhooks";
      sendError(
        reply,
        413,
        isWebhook ? "GITHUB_WEBHOOK_BODY_TOO_LARGE" : "REQUEST_BODY_TOO_LARGE",
        isWebhook
          ? "The GitHub webhook body exceeds 256 KiB."
          : "The request body exceeds the configured limit.",
      );
      return;
    }
    if (
      error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" &&
      request.routeOptions.url === "/api/github/webhooks"
    ) {
      sendError(
        reply,
        415,
        "GITHUB_WEBHOOK_CONTENT_TYPE_REQUIRED",
        "GitHub webhook intake requires application/json.",
      );
      return;
    }
    if (error instanceof EvaluationNotFoundError) {
      sendError(reply, 404, error.code, "The evaluation was not found.");
      return;
    }
    if (
      error instanceof DecisionNotAllowedError ||
      error instanceof EvaluationAlreadyResolvedError ||
      error instanceof IdempotencyConflictError
    ) {
      sendError(reply, 409, error.code, error.message);
      return;
    }

    request.log.error({ err: error }, "QuietOps request failed");
    sendError(
      reply,
      500,
      "INTERNAL_ERROR",
      "The request could not be completed.",
    );
  });

  app.get("/health", async () => ({ status: "ok" }));

  if (releaseCommit) {
    app.get(RELEASE_MARKER_PATH, async () => ({
      schemaVersion: "1",
      repository: QUIETOPS_REPOSITORY,
      commit: releaseCommit,
    }));
  }

  if (githubWebhook && releaseRunService) {
    app.register(async (webhookApp) => {
      webhookApp.removeContentTypeParser("application/json");
      webhookApp.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_request, body, done) => done(null, body),
      );

      webhookApp.post<{
        Body: Buffer;
      }>(
        "/api/github/webhooks",
        { bodyLimit: MAX_GITHUB_WEBHOOK_BODY_BYTES },
        async (request, reply) => {
          if (!hasJsonContentType(request.headers["content-type"])) {
            sendError(
              reply,
              415,
              "GITHUB_WEBHOOK_CONTENT_TYPE_REQUIRED",
              "GitHub webhook intake requires application/json.",
            );
            return;
          }
          if (!Buffer.isBuffer(request.body)) {
            sendError(
              reply,
              400,
              "GITHUB_WEBHOOK_INVALID_BODY",
              "GitHub webhook intake requires a bounded raw body.",
            );
            return;
          }

          const inspection = inspectGitHubPushWebhook({
            rawBody: request.body,
            secret: githubWebhook.secret,
            signature: readSingleHeader(request.headers["x-hub-signature-256"]),
            event: readSingleHeader(request.headers["x-github-event"]),
            deliveryId: readSingleHeader(request.headers["x-github-delivery"]),
          });
          if (!inspection.accepted) {
            return reply.code(202).send({
              accepted: false,
              reason: inspection.reason,
            });
          }

          const result = releaseRunService.createFromTrigger({
            candidateCommit: inspection.candidateCommit,
            deliveryId: inspection.deliveryId,
            policyProfile: resolvePolicyProfile("standard-v1"),
            occurredAt: (githubWebhook.now?.() ?? new Date()).toISOString(),
          });
          return reply.code(202).send({
            accepted: true,
            runId: result.runId,
            replayed: result.replayed,
          });
        },
      );
    });
  }

  app.get("/api/inbox", async () => ({
    capabilities: Object.freeze({
      decisionMode,
      liveVerification: Object.freeze({
        enabled: releaseCommit !== undefined,
        repository: QUIETOPS_REPOSITORY,
        branch: "main",
      }),
    }),
    items: service.listInbox(),
  }));

  app.post("/api/live-verifications", async (_request, reply) => {
    if (!releaseCommit) {
      sendError(
        reply,
        503,
        "LIVE_VERIFICATION_NOT_CONFIGURED",
        "Live release verification requires a configured release identity.",
      );
      return;
    }
    const result = await service.startLiveReleaseVerification(
      `release:${releaseCommit}`,
    );
    return {
      receipt: Object.freeze({
        evaluationId: result.evaluation.evaluationId,
        replayed: result.replayed,
      }),
      evaluation: result.evaluation,
    };
  });

  app.get<{ Params: EvaluationParams }>(
    "/api/evaluations/:evaluationId",
    {
      schema: {
        params: evaluationParamsSchema,
      },
    },
    async (request) => ({
      evaluation: service.getEvaluation(request.params.evaluationId),
    }),
  );

  app.post<{
    Params: EvaluationParams;
    Headers: DecisionHeaders;
    Body: DecisionBody;
  }>(
    "/api/evaluations/:evaluationId/decisions",
    {
      schema: {
        params: evaluationParamsSchema,
        headers: decisionHeadersSchema,
        body: decisionBodySchema,
      },
    },
    async (request, reply) => {
      if (decisionMode === "public-read-only") {
        sendError(
          reply,
          403,
          "PUBLIC_DEMO_READ_ONLY",
          "This public demo preserves shared evidence and does not accept decisions.",
        );
        return;
      }
      const receipt = await service.recordDecision({
        evaluationId: request.params.evaluationId,
        decision: request.body.decision,
        actor: request.body.actor,
        ...(request.body.note ? { note: request.body.note } : {}),
        idempotencyKey: request.headers["idempotency-key"],
      });
      return {
        receipt,
        evaluation: service.getEvaluation(receipt.evaluationId),
        ...(receipt.childEvaluationId
          ? {
              childEvaluation: service.getEvaluation(receipt.childEvaluationId),
            }
          : {}),
      };
    },
  );

  for (const [route, file] of Object.entries(PUBLIC_FILES)) {
    app.get(route, async (_request, reply) => {
      const body = await readFile(
        fileURLToPath(new URL(file.name, PUBLIC_DIRECTORY)),
      );
      return reply.type(file.contentType).send(body);
    });
  }

  app.setNotFoundHandler((_request, reply) => {
    sendError(reply, 404, "NOT_FOUND", "The requested resource was not found.");
  });

  try {
    if (options.seedDemo && service.listInbox().length === 0) {
      await service.startDemoEvaluations(["ready", "deployed-sha-mismatch"]);
    }
  } catch (error) {
    await app.close();
    throw error;
  }

  return app;
}

function normalizeDecisionMode(value: DecisionMode | undefined): DecisionMode {
  if (value === undefined || value === "local-interactive") {
    return "local-interactive";
  }
  if (value === "public-read-only") return value;
  throw new Error(`Unknown QuietOps decision mode: ${String(value)}.`);
}

function normalizeReleaseCommit(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(
      "releaseCommit must be 40 lowercase hexadecimal characters.",
    );
  }
  return value;
}

function normalizeGitHubWebhook(
  value: GitHubWebhookServerOptions | undefined,
): GitHubWebhookServerOptions | undefined {
  if (value === undefined) return undefined;
  const bytes = Buffer.byteLength(value.secret, "utf8");
  if (
    value.secret.trim() !== value.secret ||
    /[\u0000-\u001f\u007f]/.test(value.secret) ||
    bytes < 32 ||
    bytes > 256
  ) {
    throw new Error(
      "GitHub webhook secret must be 32-256 bytes without surrounding whitespace or control characters.",
    );
  }
  return Object.freeze({
    secret: value.secret,
    ...(value.now ? { now: value.now } : {}),
  });
}

function createReleaseWorker(
  service: ReleaseRunService,
  options: ReleaseWorkerServerOptions,
  defaultOnError: (error: unknown) => void,
): ReleaseRunWorker {
  const { onShutdown: _onShutdown, ...workerOptions } = options;
  return new ReleaseRunWorker({
    ...workerOptions,
    service,
    onError: options.onError ?? defaultOnError,
  });
}

function readSingleHeader(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hasJsonContentType(value: string | undefined): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

const evaluationParamsSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["evaluationId"],
  properties: {
    evaluationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
    },
  },
});

const decisionHeadersSchema = Object.freeze({
  type: "object",
  required: ["idempotency-key"],
  properties: {
    "idempotency-key": {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    },
  },
});

const decisionBodySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["decision", "actor"],
  properties: {
    decision: {
      type: "string",
      enum: ["Reject", "Re-check requested"],
    },
    actor: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^\\S(?:.*\\S)?$",
    },
    note: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      pattern: "^\\S(?:[\\s\\S]*\\S)?$",
    },
  },
});

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
): void {
  void reply.code(statusCode).send({
    error: Object.freeze({ code, message }),
  });
}
