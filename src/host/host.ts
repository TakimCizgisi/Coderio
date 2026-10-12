/**
 * Motor sürecinin giriş noktası.
 *
 * Ana süreç bu dosyayı `utilityProcess.fork()` ile başlatır ve `MessagePort`
 * üzerinden konuşur. Süreç `ELECTRON_RUN_AS_NODE=1` ortamında çalışır: Node.js
 * Electron içinde gömülüdür, sistemde kurulu olması gerekmez.
 *
 * `node-llama-cpp` ESM olduğu için bu dosya da ESM olarak derlenir
 * (`dist/host.js`). Gerçek iş mantığı `serve.ts` içindedir; burada yalnızca
 * süreç ortamı çözülür ve kapanış yönetilir.
 */
import path from "node:path";
import process from "node:process";
import { startEngineHost } from "./serve.js";
import type { MessageEndpoint } from "../protocol/channel.js";
import { logger, type LogLevel } from "../utils/paths.js";

const parentPort = (process as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
    // Bu noktaya düşmek `ELECTRON_RUN_AS_NODE` açıkken olur; o modda süreç
    // "düz Node"a çevrilir ve `process.parentPort` kaybolur. Nedeni görebilmek
    // için hatayı burada da logla — `uncaughtException` henüz kurulmadığı için
    // aşağıdaki `throw` süreci sessizce sonlandırır.
    logger.error(
        "process.parentPort not found — the engine may have been started with ELECTRON_RUN_AS_NODE=1; " +
            "this mode is not supported",
    );
    throw new Error("Coderio engine can only be started by the main process");
}

/**
 * Electron'un alt süreç tarafı, `on("message")` olayını **ham değer** değil
 * `MessageEvent` zarfı olarak verir (`electron.d.ts` → `ParentPort`). Kanal
 * sözleşmesi ise ham çerçeve beklediği için zarf burada açılır.
 *
 * `start()`/`close()` Electron `ParentPort`'unda yoktur; mesajlar dinleyici
 * bağlanana kadar kuyruğa alındığı için `start()` çağrısına gerek yoktur.
 */
const port: MessageEndpoint = {
    postMessage: (message: unknown) => parentPort.postMessage(message),
    on: (event, listener) => parentPort.on(event, (messageEvent) => listener(messageEvent.data))
};

/** `electron` tiplerini çalışma zamanında içe aktarmadan tanımlar. */
interface ParentPortLike {
    postMessage(message: unknown): void;
    on(event: "message", listener: (messageEvent: { data: unknown }) => void): unknown;
}

const { dispose } = startEngineHost(port, readCwd(), {
    logLevel: readLogLevel(process.env.CODERIO_LOG_LEVEL),
    // `shutdown` isteği işlendi ve model belleği bırakıldı: süreç sonlanabilir.
    onShutdownRequested: () => process.exit(0)
});

/** Beklenmedik kapanma (SIGTERM, çökme) için aynı temizlik yolu. */
async function shutdown(code: number): Promise<never> {
    try {
        await dispose();
    } catch (err) {
        logger.warn(`shutdown: ${String(err)}`);
    }
    port.close?.();
    process.exit(code);
}

process.on("SIGTERM", () => void shutdown(0));
process.on("uncaughtException", (err) => {
    logger.error(`engine crashed: ${err.stack ?? err.message}`);
    void shutdown(1);
});

/** Ana süreçten gelen çalışma dizini; yoksa sürecinki. */
function readCwd(): string {
    const flag = process.argv.indexOf("--cwd");
    const value = flag !== -1 ? process.argv[flag + 1] : undefined;
    return value ? path.resolve(value) : process.cwd();
}

function readLogLevel(value: string | undefined): LogLevel {
    return value === "silent" || value === "error" || value === "warn" || value === "debug" ? value : "info";
}
