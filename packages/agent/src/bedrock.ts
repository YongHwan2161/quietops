import { BedrockModel } from "@strands-agents/sdk";

export const BEDROCK_CONFIGURATION_HOLD =
  "AWS_REGION_OR_QUIETOPS_MODEL_ID_MISSING" as const;

export interface BedrockEnvironment {
  readonly AWS_REGION?: string;
  readonly QUIETOPS_MODEL_ID?: string;
}

export interface BedrockMismatchConfiguration {
  readonly region: string;
  readonly modelId: string;
}

export class BedrockConfigurationError extends Error {
  readonly code = BEDROCK_CONFIGURATION_HOLD;
  readonly missing: readonly (keyof BedrockEnvironment)[];

  constructor(missing: readonly (keyof BedrockEnvironment)[]) {
    super(`${BEDROCK_CONFIGURATION_HOLD}: missing ${missing.join(", ")}`);
    this.name = "BedrockConfigurationError";
    this.missing = Object.freeze([...missing]);
  }
}

export function readBedrockMismatchConfiguration(
  environment: BedrockEnvironment,
): BedrockMismatchConfiguration {
  const region = environment.AWS_REGION?.trim();
  const modelId = environment.QUIETOPS_MODEL_ID?.trim();
  const missing: (keyof BedrockEnvironment)[] = [];

  if (!region) missing.push("AWS_REGION");
  if (!modelId) missing.push("QUIETOPS_MODEL_ID");
  if (!region || !modelId) throw new BedrockConfigurationError(missing);

  return Object.freeze({ region, modelId });
}

export function createBedrockMismatchModel(
  environment: BedrockEnvironment = process.env,
): BedrockModel {
  const configuration = readBedrockMismatchConfiguration(environment);

  return new BedrockModel({
    modelId: configuration.modelId,
    region: configuration.region,
    temperature: 0,
    maxTokens: 1_024,
    clientConfig: { maxAttempts: 2 },
  });
}
