import {
  GITHUB_EVIDENCE_ERROR_CODES,
  GitHubEvidenceError,
  QUIETOPS_GITHUB_TARGET,
  collectGitHubSourceAndCiEvidence,
} from "./github-evidence.js";

async function main(): Promise<void> {
  try {
    const evidence = await collectGitHubSourceAndCiEvidence(
      QUIETOPS_GITHUB_TARGET,
    );
    console.log(
      JSON.stringify(
        {
          status: "PASS",
          mode: "github-public-read-only",
          evidence,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const code =
      error instanceof GitHubEvidenceError
        ? error.code
        : GITHUB_EVIDENCE_ERROR_CODES.network;
    const message = error instanceof Error ? error.message : "Unknown failure.";
    console.error(JSON.stringify({ status: "HOLD", code, message }, null, 2));
    process.exitCode = 1;
  }
}

await main();
