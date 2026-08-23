import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  DecisionNotAllowedError,
  EvaluationAlreadyResolvedError,
  EvaluationNotFoundError,
  EvaluationService,
  type EvaluationServiceOptions,
} from "@quietops/application";
import {
  IdempotencyConflictError,
  SQLiteEvaluationLedger,
} from "@quietops/storage";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
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

export interface CreateQuietOpsServerOptions {
  readonly databasePath?: string;
  readonly seedDemo?: boolean;
  readonly evaluationServiceOptions?: EvaluationServiceOptions;
  readonly logger?: boolean;
  readonly decisionMode?: DecisionMode;
  readonly releaseCommit?: string;
}

export type DecisionMode = "local-interactive" | "public-read-only";

export async function createQuietOpsServer(
  options: CreateQuietOpsServerOptions = {},
): Promise<FastifyInstance> {
  const decisionMode = normalizeDecisionMode(options.decisionMode);
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  const ledger = new SQLiteEvaluationLedger(options.databasePath);
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

  app.addHook("onClose", () => {
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
