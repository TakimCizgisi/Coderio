/**
 * IPC testinin motor tarafı: `worker_threads` içinde `startEngineHost` çalıştırır.
 *
 * `process.parentPort` yalnızca `utilityProcess.fork()` alt süreçlerinde vardır;
 * düz bir Worker'da bulunmaz. Bu yüzden motor `startEngineHost(parentPort, cwd)`
 * ile açıkça başlatılır — üretimdekiyle birebir aynı kod yolu.
 */
import { parentPort, workerData } from "node:worker_threads";
import { startEngineHost } from "../src/host/serve.js";

if (!parentPort) throw new Error("worker parentPort missing");

const { cwd } = workerData as { cwd: string };

startEngineHost(parentPort, cwd, {
    logLevel: "error",
    onShutdownRequested: () => process.exit(0)
});
