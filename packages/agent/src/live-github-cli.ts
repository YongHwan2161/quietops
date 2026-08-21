import { runLiveGitHubSourceCiSlice } from "./run-live-github.js";

const result = await runLiveGitHubSourceCiSlice();
process.stdout.write(
  `${JSON.stringify({ status: "PASS", result }, null, 2)}\n`,
);
