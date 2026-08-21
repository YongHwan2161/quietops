import type { DecisionMode } from "./server.js";

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface QuietOpsRuntimeConfig {
  readonly host: "127.0.0.1" | "0.0.0.0";
  readonly port: number;
  readonly decisionMode: DecisionMode;
}

export function resolveQuietOpsRuntimeConfig(
  environment: RuntimeEnvironment = process.env,
): QuietOpsRuntimeConfig {
  const host = parseHost(environment.QUIETOPS_HOST);
  const port = parsePorts(environment.PORT, environment.QUIETOPS_PORT);
  const decisionMode = parseDecisionMode(environment.QUIETOPS_DECISION_MODE);

  if (host === "0.0.0.0" && decisionMode !== "public-read-only") {
    throw new Error(
      "QUIETOPS_HOST=0.0.0.0 requires QUIETOPS_DECISION_MODE=public-read-only.",
    );
  }

  return Object.freeze({ host, port, decisionMode });
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
