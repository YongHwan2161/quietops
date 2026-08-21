import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createQuietOpsServer } from "./server.js";

const host = "127.0.0.1";
const port = parsePort(process.env.QUIETOPS_PORT);
const decisionMode = parseDecisionMode(process.env.QUIETOPS_DECISION_MODE);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const databasePath = resolve(
  repositoryRoot,
  process.env.QUIETOPS_DB_PATH ?? ".quietops/quietops.sqlite",
);

await mkdir(dirname(databasePath), { recursive: true });

const app = await createQuietOpsServer({
  databasePath,
  decisionMode,
  seedDemo: true,
  logger: true,
});

await app.listen({ host, port });

console.log(
  JSON.stringify({
    status: "ready",
    url: `http://${host}:${port}`,
    databasePath,
    decisionMode,
    externalMutations: 0,
  }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}

function parseDecisionMode(
  value: string | undefined,
): "local-interactive" | "public-read-only" {
  if (value === undefined || value === "local-interactive") {
    return "local-interactive";
  }
  if (value === "public-read-only") return value;
  throw new Error(
    "QUIETOPS_DECISION_MODE must be local-interactive or public-read-only.",
  );
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 4173;
  if (!/^\d+$/.test(value)) {
    throw new Error("QUIETOPS_PORT must be an integer from 1 through 65535.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("QUIETOPS_PORT must be an integer from 1 through 65535.");
  }
  return parsed;
}
