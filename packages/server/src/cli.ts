import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveQuietOpsRuntimeConfig } from "./runtime-config.js";
import { createQuietOpsServer } from "./server.js";

const { host, port, decisionMode } = resolveQuietOpsRuntimeConfig(process.env);
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
