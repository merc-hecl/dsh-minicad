export async function renderPhotos(buffer, views, signal) {
  signal.throwIfAborted();
  const worker = new Worker(__MINICAD_RENDER_WORKER_URL__, { type: "module" });
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      worker.onmessage = ({ data: { images, error } }) => {
        if (error) reject(new Error(error));
        else resolve(images);
      };
      worker.onerror = event => reject(new Error(event.message || "Could not load the model photo worker"));
      worker.postMessage({ buffer, views }, [buffer]);
    });
  } finally {
    signal.removeEventListener("abort", abort);
    worker.terminate();
  }
}
