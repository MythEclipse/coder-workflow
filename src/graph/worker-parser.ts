import { parentPort } from "node:worker_threads";

if (!parentPort) {
  throw new Error("This script must be run as a worker thread.");
}

parentPort.on(
  "message",
  (message: { id: number; action: "parse" | "stringify"; payload: string | any }) => {
    try {
      if (message.action === "parse") {
        const result = JSON.parse(message.payload as string);
        parentPort!.postMessage({ id: message.id, result });
      } else if (message.action === "stringify") {
        const result = JSON.stringify(message.payload);
        parentPort!.postMessage({ id: message.id, result });
      }
    } catch (error) {
      parentPort!.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
