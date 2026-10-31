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
  console.error(error.stack || error);
  process.stdout.write(
    JSON.stringify({
      id: request.id,
      error: String(error.message || error),
      status: error.status || 400,
    }) + "\n",
    () => process.exit(0),
  );
}
