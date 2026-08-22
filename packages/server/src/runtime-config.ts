import { isAbsolute, relative, resolve, sep } from "node:path";

import type { DecisionMode } from "./server.js";

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface ResolveQuietOpsRuntimeConfigOptions {
  readonly repositoryRoot?: string;
}

export interface QuietOpsRuntimeConfig {
  readonly host: "127.0.0.1" | "0.0.0.0";
  readonly port: number;
  readonly decisionMode: DecisionMode;
  readonly databasePath: string;
  readonly releaseCommit?: string;
}

export function resolveQuietOpsRuntimeConfig(
  environment: RuntimeEnvironment = process.env,
  options: ResolveQuietOpsRuntimeConfigOptions = {},
): QuietOpsRuntimeConfig {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const host = parseHost(environment.QUIETOPS_HOST);
  const port = parsePorts(environment.PORT, environment.QUIETOPS_PORT);
  const decisionMode = parseDecisionMode(environment.QUIETOPS_DECISION_MODE);
  const releaseCommit = parseReleaseCommit(environment.QUIETOPS_RELEASE_COMMIT);
  const databasePath = parseDatabasePath(
    environment.QUIETOPS_DB_PATH,
    repositoryRoot,
    host,
  );

  if (host === "0.0.0.0" && decisionMode !== "public-read-only") {
    throw new Error(
      "QUIETOPS_HOST=0.0.0.0 requires QUIETOPS_DECISION_MODE=public-read-only.",
    );
  }
  if (host === "0.0.0.0" && releaseCommit === undefined) {
    throw new Error(
      "QUIETOPS_HOST=0.0.0.0 requires a full QUIETOPS_RELEASE_COMMIT.",
    );
  }

  return Object.freeze({
    host,
    port,
    decisionMode,
    databasePath,
    ...(releaseCommit ? { releaseCommit } : {}),
  });
}

function parseHost(value: string | undefined): QuietOpsRuntimeConfig["host"] {
  if (value === undefined || value === "127.0.0.1") return "127.0.0.1";
  if (value === "0.0.0.0") return value;
  throw new Error("QUIETOPS_HOST must be 127.0.0.1 or 0.0.0.0.");
}

function parsePorts(
  platformValue: string | undefined,
  quietOpsValue: string | undefined,
): number {
  const platformPort = parseOptionalPort(platformValue, "PORT");
  const quietOpsPort = parseOptionalPort(quietOpsValue, "QUIETOPS_PORT");
  if (
    platformPort !== undefined &&
    quietOpsPort !== undefined &&
    platformPort !== quietOpsPort
  ) {
    throw new Error("PORT and QUIETOPS_PORT must match when both are set.");
  }
  return platformPort ?? quietOpsPort ?? 4173;
}

function parseOptionalPort(
  value: string | undefined,
  name: "PORT" | "QUIETOPS_PORT",
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer from 1 through 65535.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer from 1 through 65535.`);
  }
  return parsed;
}

function parseDecisionMode(value: string | undefined): DecisionMode {
  if (value === undefined || value === "local-interactive") {
    return "local-interactive";
  }
  if (value === "public-read-only") return value;
  throw new Error(
    "QUIETOPS_DECISION_MODE must be local-interactive or public-read-only.",
  );
}

function parseReleaseCommit(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(
      "QUIETOPS_RELEASE_COMMIT must be 40 lowercase hexadecimal characters.",
    );
  }
  return value;
}

function parseDatabasePath(
  value: string | undefined,
  repositoryRoot: string,
  host: QuietOpsRuntimeConfig["host"],
): string {
  if (value !== undefined && (value.length === 0 || value.includes("\0"))) {
    throw new Error("QUIETOPS_DB_PATH must be a non-empty filesystem path.");
  }

  if (host === "0.0.0.0" && (value === undefined || !isAbsolute(value))) {
    throw new Error(
      "QUIETOPS_HOST=0.0.0.0 requires an absolute QUIETOPS_DB_PATH.",
    );
  }

  const databasePath = resolve(
    repositoryRoot,
    value ?? ".quietops/quietops.sqlite",
  );
  if (host === "0.0.0.0" && isWithin(repositoryRoot, databasePath)) {
    throw new Error(
      "Public QUIETOPS_DB_PATH must be outside the application repository.",
    );
  }
  return databasePath;
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}
