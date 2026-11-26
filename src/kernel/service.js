import { createInterface } from "node:readline";
import { Console } from "node:console";
import { Store } from "./store.js";
globalThis.console = new Console(process.stderr);
const root = process.argv[process.argv.indexOf("--data-dir") + 1];
const previewSession = process.argv.includes("--preview-session");
for await (const line of createInterface({ input: process.stdin })) {
  let request = {}, reply;
  try {
    request = JSON.parse(line);
    const result = await new Store(root).dispatch(request.method, request.params || {});
    reply = { id: request.id, result };
  } catch (error) {
    const english = error?.localized?.en;
    const frames = error?.stack ? error.stack.split("\n").slice(1).join("\n") : "";
    console.error(english === undefined ? error.stack || error
      : frames ? `Error: ${english}\n${frames}` : `Error: ${english}`);
    reply = {
      id: request.id,
      error: String(error.message || error),
      localized: error.localized,
      status: error.status || 400,
      operationIndex: error.operationIndex,
      operation: error.operation,
      code: error.code,
      details: error.details,
      phase: error.phase,
      runId: error.runId,
      validation: error.validation,
      diagnostics: error.diagnostics,
    };
  }
  process.stdout.write(JSON.stringify(reply) + "\n", previewSession ? undefined : () => process.exit(0));
  if (!previewSession) break;
}
