import { runMismatchSlice } from "./run-mismatch.js";

const result = await runMismatchSlice();

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
