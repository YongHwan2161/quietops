import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveQuietOpsRuntimeConfig } from "./runtime-config.js";
import { createQuietOpsServer } from "./server.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const {
  host,
  port,
  decisionMode,
  databasePath,
  releaseCommit,
  githubWebhookEnabled,
  githubWebhookSecret,
  operatorToken,
} = resolveQuietOpsRuntimeConfig(process.env, { repositoryRoot });

await mkdir(dirname(databasePath), { recursive: true });

const app = await createQuietOpsServer({
  databasePath,
  decisionMode,
  ...(releaseCommit ? { releaseCommit } : {}),
  ...(githubWebhookEnabled
    ? { githubWebhook: { secret: githubWebhookSecret! } }
    : {}),
  ...(operatorToken ? { releaseDecision: { operatorToken } } : {}),
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
    githubWebhookEnabled,
    ...(releaseCommit ? { releaseCommit } : {}),
    externalMutations: 0,
  }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
