import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBedrockMismatchModel,
  runLiveReleaseVerification,
  runReleaseStewardIncidentAction,
  runReleaseStewardObservation,
} from "@quietops/agent";
import { executeGitHubIncident } from "@quietops/adapters";

import { resolveQuietOpsRuntimeConfig } from "./runtime-config.js";
import {
  createQuietOpsServer,
  type ReleaseWorkerServerOptions,
} from "./server.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const {
  host,
  port,
  decisionMode,
  databasePath,
  releaseCommit,
  publicLiveProofEnabled,
  workerEnabled,
  singleReplicaConfirmed,
  policyProfile,
  githubWebhookEnabled,
  githubWebhookSecret,
  operatorToken,
  githubIssueToken,
  githubIssueActionEnabled,
} = resolveQuietOpsRuntimeConfig(process.env, { repositoryRoot });

await mkdir(dirname(databasePath), { recursive: true });

const workerBedrockModel = workerEnabled
  ? createBedrockMismatchModel(process.env)
  : undefined;
const publicLiveProofModel = publicLiveProofEnabled
  ? createBedrockMismatchModel(process.env)
  : undefined;
const releaseWorker: ReleaseWorkerServerOptions | undefined = workerEnabled
  ? {
      workerId: "quietops:single-replica",
      runObservation: async (request) =>
        await runReleaseStewardObservation({
          ...request,
          model: workerBedrockModel!,
          modelMode: "bedrock-live",
        }),
      ...(githubIssueActionEnabled
        ? {
            runIncidentAction: async (request) =>
              await runReleaseStewardIncidentAction({
                plan: request.plan,
                model: workerBedrockModel!,
                modelMode: "bedrock-live",
                executeIncident: async (plan) =>
                  await executeGitHubIncident(plan, {
                    token: githubIssueToken!,
                    timeoutMs: request.providerTimeoutMs,
                  }),
              }),
          }
        : {}),
    }
  : undefined;

const app = await createQuietOpsServer({
  databasePath,
  decisionMode,
  ...(releaseCommit ? { releaseCommit } : {}),
  ...(publicLiveProofEnabled
    ? {
        publicLiveVerification: {
          run: async () =>
            await runLiveReleaseVerification({
              model: publicLiveProofModel!,
              modelMode: "bedrock-live",
            }),
        },
      }
    : {}),
  ...(githubWebhookEnabled
    ? { githubWebhook: { secret: githubWebhookSecret!, policyProfile } }
    : {}),
  ...(operatorToken ? { releaseDecision: { operatorToken } } : {}),
  ...(releaseWorker ? { releaseWorker } : {}),
  readinessConfigurationPassed: workerEnabled,
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
    publicLiveProofEnabled,
    workerEnabled,
    singleReplicaConfirmed,
    policyProfile,
    githubIssueCredentialPresent: githubIssueToken !== undefined,
    githubIssueActionEnabled,
    ...(releaseCommit ? { releaseCommit } : {}),
    externalMutations: 0,
  }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
