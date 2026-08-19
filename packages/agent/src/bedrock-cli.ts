import {
  BedrockConfigurationError,
  createBedrockMismatchModel,
} from "./bedrock.js";
import { runMismatchSlice } from "./run-mismatch.js";

try {
  const result = await runMismatchSlice({
    model: createBedrockMismatchModel(),
    modelMode: "bedrock-live",
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  if (error instanceof BedrockConfigurationError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
