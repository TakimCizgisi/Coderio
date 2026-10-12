/**
 * MessagePort tabanlı kanal — dışarıya açık hiçbir uç nokta yok.
 *
 * Coderio'da motor, ana süreç tarafından `utilityProcess.fork()` ile başlatılan
 * gizli bir alt süreçtir. İki taraf arasındaki tek haberleşme yolu budur: ne
 * named pipe var, ne Unix socket, ne TCP portu. Kanal yalnızca süreç içi
 * `MessagePort`'lar üzerinde çalışır; bu yüzden mesajlar JSON satırı değil,
 * doğrudan yapısal klonlanmış nesnedir (token/diff gibi büyük yüklerde
 * çerçeveleme maliyeti ve `JSON.stringify` güvenlik girişi ortadan kalkar).
 *
 * Aynı arayüzün `worker_threads` portlarını da karşılaması, protokolün
 * Electron olmadan `scripts/smoke-ipc.ts` ile test edilmesini sağlar.
 */

import type { Request } from "./messages.js";

/**
 * Hem `worker_threads.MessagePort` hem Electron'un `process.parentPort`'ı bu
 * yapıyı sağlar. `start()` bazı portlarda zaten çağrılmış olabileceği için
 * opsiyonel kabul edilir.
 */
export interface MessageEndpoint {
    postMessage(message: unknown): void;
    on(event: "message", listener: (value: unknown) => void): unknown;
    start?(): void;
    close?(): void;
}

/** Motor tarafı: `istek (frame) -> yanıt` işleyicisini porta bağlar. */
export type RequestHandler = (frame: unknown) => Promise<unknown> | unknown;

/**
 * Motor tarafı giriş noktası.
 *
 * Gelen çerçevenin geçerli bir istek olup olmadığını doğrular; bozuk ya da
 * eksik çerçeveler karşı tarafı düşürmek yerine `onError`'e bildirilir.
 */
export function attachRequestHandler(
    port: MessageEndpoint,
    handler: RequestHandler,
    onError?: (err: Error) => void
): void {
    port.on("message", (value: unknown) => {
        const frame = value as { id?: unknown; req?: { type?: unknown } };
        if (typeof frame?.id !== "number" || typeof frame.req?.type !== "string") {
            onError?.(new Error("invalid request frame"));
            return;
        }
        void Promise.resolve(handler(value)).catch((err) => {
            // Handler istisna atarsa istek asılı kalmasın; hata yanıtına dönüşür.
            port.postMessage({ id: frame.id as number, ok: false, error: String((err as Error)?.message ?? err) });
        });
    });
    port.start?.();
}

/** Motor tarafı: isteğe karşılık yanıt yollar. */
export function reply(port: MessageEndpoint, id: number, result: unknown): void {
    port.postMessage({ id, ok: true, result });
}

/** Motor tarafı: hatayı isteğin `id`'siyle eşleşen yanıta çevirir. */
export function replyError(port: MessageEndpoint, id: number, error: string): void {
    port.postMessage({ id, ok: false, error });
}

/** Motor tarafı: olay (token, araç çağrısı, ...) yayını. */
export function emit(port: MessageEndpoint, event: Record<string, unknown> & { event: string }): void {
    port.postMessage(event);
}

/** İstek sonucu — `request()` her zaman çözer, hiçbir zaman reddetmez. */
export type ChannelResult<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

/**
 * Ana süreç tarafı kanal.
 *
 * Yanıtları `id` eşleşen isteğe bağlar, olayları `onEvent`'e aktarır. Port
 * kapanırsa bekleyen istekler hata ile çözülür; böylece renderer'ın isteği
 * asılı kalmaz.
 */
export class EngineChannel {
    private nextId = 1;
    private closed = false;
    private readonly pending = new Map<number, (value: ChannelResult) => void>();

    constructor(
        private readonly port: MessageEndpoint,
        private readonly onEvent: (event: { event: string }) => void,
        private readonly onClose: (reason?: Error) => void = () => {}
    ) {
        port.on("message", (value: unknown) => this.handle(value));
        port.start?.();
    }

    /** Port'u kapatır ve bekleyen istekleri çözer. */
    close(reason = "engine connection closed"): void {
        if (this.closed) return;
        this.closed = true;
        this.failAll(reason);
        this.port.close?.();
        this.onClose();
    }

    request<T = unknown>(req: Request): Promise<ChannelResult<T>> {
        if (this.closed) return Promise.resolve({ ok: false, error: "engine connection closed" });
        const id = this.nextId++;
        return new Promise<ChannelResult<T>>((resolve) => {
            this.pending.set(id, resolve as (value: ChannelResult) => void);
            try {
                this.port.postMessage({ id, req });
            } catch (err) {
                this.pending.delete(id);
                resolve({ ok: false, error: String((err as Error)?.message ?? err) });
            }
        });
    }

    private handle(value: unknown): void {
        const frame = value as { id?: unknown; event?: unknown; ok?: unknown; result?: unknown; error?: unknown };
        if (typeof frame?.event === "string") {
            this.onEvent(frame as { event: string });
            return;
        }
        if (typeof frame.id !== "number") return;
        const resolve = this.pending.get(frame.id);
        if (!resolve) return;
        this.pending.delete(frame.id);
        resolve(frame.ok === true ? { ok: true, result: frame.result } : { ok: false, error: String(frame.error ?? "bilinmeyen hata") });
    }

    /** Port kapanırken bekleyen istekleri hata ile çöz; çağıran takılmasın. */
    private failAll(error: string): void {
        for (const [, resolve] of this.pending) resolve({ ok: false, error });
        this.pending.clear();
    }
}
