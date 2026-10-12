/**
 * Motorun çalıştırılabilir çekirdeği — giriş noktasından bağımsız.
 *
 * Verilen bir `MessageEndpoint` üzerinde motoru ayağa kaldırır. Aynı kod iki
 * ortamda çalışır:
 *
 *  - uygulamada: `utilityProcess.fork()` ile başlatılan alt süreç (`host.ts`)
 *  - testte:     `worker_threads.Worker` (`scripts/smoke-ipc.ts`)
 *
 * Hiçbir yerde dinleyici açılmaz; kanal her zaman dışarıdan verilir.
 */
import { Runner } from "./runner.js";
import { attachRequestHandler, emit, reply, replyError, type MessageEndpoint } from "../protocol/channel.js";
import { PROTOCOL_VERSION, type Request, type Result, type SessionSummary } from "../protocol/messages.js";
import { logger, setLogLevel, type LogLevel } from "../utils/paths.js";
import { CODERIO_VERSION } from "../version.js";

export type EngineRuntime = {
    runner: Runner;
    /** Motoru kapatır (model belleğini bırakır). Yanıt gönderilmiş olmalıdır. */
    dispose(): Promise<void>;
};

export type StartOptions = {
    logLevel?: LogLevel;
    /** `shutdown` isteği yanıtlandıktan sonra çağrılır. */
    onShutdownRequested?: () => void;
};

/** Motoru verilen port üzerinde başlatır ve isteklere yanıt vermeye başlar. */
export function startEngineHost(port: MessageEndpoint, cwd: string, options: StartOptions = {}): EngineRuntime {
    setLogLevel(options.logLevel ?? "info");

    const runner = new Runner(cwd);
    runner.subscribe((event) => emit(port, event));

    let closing: Promise<void> | undefined;
    const dispose = async (): Promise<void> => {
        await runner.dispose();
        port.close?.();
    };

    attachRequestHandler(
        port,
        async (frame) => {
            const { id, req } = frame as { id: number; req: Request };
            try {
                reply(port, id, await handle(req));
            } catch (err) {
                // İşleyici istisna atarsa istek asılı kalmasın; hata yanıtına dönüşür.
                replyError(port, id, err instanceof Error ? err.message : String(err));
            }
            // `shutdown`: yanıt yola çıktıktan sonra kapat.
            if (closing) await closing;
        },
        (err) => logger.error(`channel: ${err.message}`)
    );

    /**
     * İstekten sonucu üretir.
     *
     * Sohbet yanıtı token/olay akışıyla iletilir; buradaki sonuç yalnızca işin
     * bittiğini ve hata var mı bilgisini taşır.
     */
    async function handle(req: Request): Promise<Result> {
        switch (req.type) {
            case "ping":
                return { type: "pong", protocol: PROTOCOL_VERSION, version: CODERIO_VERSION };

            case "status":
                return { type: "status", status: await runner.status() };

            case "set-config":
                await runner.setConfig(req.patch);
                // Ayar "always" ise modeli hemen ısıt (canlı uygula); kapalıysa
                // `setConfig` zaten agent'ı dispose etmiş olduğundan yüklenmez.
                if (runner.instance.getConfig().autostartModel !== false) {
                    void runner.warmUp().catch(() => undefined);
                }
                return { type: "config", config: runner.instance.getConfig() };

            case "list-models":
                return { type: "models", models: await runner.listModels() };

            case "install-model":
                return { type: "model", id: req.id, ...(await runner.installModel(req.id)) };

            case "remove-model":
                return { type: "model", id: req.id, ...(await runner.removeModel(req.id)) };

            case "use-model":
                return { type: "model", id: req.id, ...(await runner.useModel(req.id)) };

            case "refresh-models": {
                const r = await runner.refreshModels();
                return { type: "models-refreshed", ok: r.ok, count: r.count ?? 0, error: r.error };
            }

            case "chat": {
                const r = await runner.sendMessage(req.text, req.modelId);
                return { type: "ok", error: r.ok ? undefined : r.error };
            }

            case "abort":
                runner.abort();
                return { type: "ok" };

            case "new-chat":
                await runner.reset();
                return { type: "ok" };

            case "get-history":
                return { type: "history", messages: runner.getHistory() };

            case "list-sessions":
                return { type: "sessions", sessions: (await runner.listSessions()).map(toSummary) };

            case "load-session": {
                const session = await runner.loadSession(req.id);
                return session
                    ? { type: "session", session, ok: true }
                    : { type: "session", session: null, ok: false, error: `session not found: ${req.id}` };
            }

            case "save-session": {
                await runner.saveSession(req.session);
                return { type: "session", session: req.session, ok: true };
            }

            case "delete-session":
                await runner.deleteSession(req.id);
                return { type: "session", session: null, ok: true };

            case "shutdown":
                // Kapatma, yanıt gönderildikten sonra burada başlatılır.
                closing = (async () => {
                    logger.info("shutting down engine");
                    // Önce model belleğini bırak, ancak ondan sonra haber ver:
                    // bildirim alanı süreci sonlandıracaksa bellek henüz boş
                    // olmalıdır.
                    await dispose();
                    options.onShutdownRequested?.();
                })();
                return { type: "shutdown", ok: true };

            default:
                throw new Error(`unknown request: ${String((req as { type?: string }).type)}`);
        }
    }

    logger.info(`engine ready (cwd ${cwd}, version ${CODERIO_VERSION})`);

    // Ayar "always" ise modeli açılışta arka planda hazırla (sıcak tut): kullanıcı
    // ilk mesajda beklemesin, "yeni sohbet" modeli asla kapatmasın. Kapalıysa
    // model ilk mesajda yüklenir (status.loading idle kalır, send kilitlenmez).
    // Model yoksa sessizce atla.
    if (runner.instance.getConfig().autostartModel !== false) {
        void runner
            .warmUp()
            .catch((err) => logger.warn(`warm-up failed: ${err instanceof Error ? err.message : String(err)}`));
    }

    return { runner, dispose };
}

function toSummary(s: { id: string; title: string; updatedAt: string }): SessionSummary {
    return { id: s.id, title: s.title, updatedAt: s.updatedAt };
}
