import { createInterface } from "node:readline";
import { Console } from "node:console";
import { Store } from "./store.js";
// Keep model logging out of the protocol. Each request has fresh module state.
globalThis.console = new Console(process.stderr);
const root = process.argv[process.argv.indexOf("--data-dir") + 1];
let request = {};
try {
  for await (const line of createInterface({ input: process.stdin })) {
    request = JSON.parse(line);
    const result = await new Store(root).dispatch(
      request.method,
      request.params || {},
    );
    process.stdout.write(
      JSON.stringify({ id: request.id, result }) + "\n",
      () => process.exit(0),
    );
    break;
  }
} catch (error) {
  // Diagnostics returned to tools are English; keep the localized message for the workbench.
  const english = error?.localized?.en;
  const frames = error?.stack ? error.stack.split("\n").slice(1).join("\n") : "";
  console.error(english === undefined ? error.stack || error
    : frames ? `Error: ${english}\n${frames}` : `Error: ${english}`);
  process.stdout.write(
    JSON.stringify({
      id: request.id,
      error: String(error.message || error),
      localized: error.localized,
      status: error.status || 400,
      operationIndex: error.operationIndex,
      operation: error.operation,
      code: error.code,
      phase: error.phase,
      runId: error.runId,
      validation: error.validation,
      diagnostics: error.diagnostics,
    }) + "\n",
    () => process.exit(0),
  );
}
