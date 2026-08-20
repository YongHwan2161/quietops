import { runJudgeDemo } from "./judge.js";

const result = await runJudgeDemo();

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
