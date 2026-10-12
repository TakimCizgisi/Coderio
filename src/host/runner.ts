/**
 * Motor çekirdeği: tek `CoderioService`, seri işlem kuyruğu, olay yayını.
 *
 * Model belleği ve bağlam tek örnek üzerinden paylaşılır; bu yüzden modele
 * dokunan istekler (chat, install, use-model, set-config) sıraya girer.
 * Durum okuyan istekler (status, list) kuyruğu atlar.
 *
 * Tek dinleyicisi vardır: ana sürece bağlı `MessagePort`. Bu yüzden sohbet
 * çıktısını "hangi istemciye" göre yönlendirmek gerekmez; tüm olaylar tek
 * porta gider.
 */
import { CoderioService, type ServiceEvents } from "../service.js";
import type { ChatHistoryItem } from "node-llama-cpp";
import type { EventFrame, HistoryMessage, StatusReport } from "../protocol/messages.js";
import { PROTOCOL_VERSION } from "../protocol/messages.js";
import { buildGpuReport } from "./gpu.js";
import { CODERIO_VERSION } from "../version.js";

type Listener = (event: EventFrame) => void;

/** Modele dokunan işlemler bu listede sırayla çalışır. */
type ExclusiveTask = () => Promise<void>;

export class Runner {
    private readonly service: CoderioService;
    private readonly listeners = new Set<Listener>();
    private queue: Promise<void> = Promise.resolve();
    private busy = false;

    /** Model ön yükleme durumu (açılışta sıcak tutma). */
    private loadState: "idle" | "loading" | "ready" = "idle";

    /** Sohbet dışı olayların varsayılan yayıncısı (model yükleme, durum) */
    private readonly baseEvents: ServiceEvents;

    /** Asistanın çalışma dizini (durum raporunda döner). */
    readonly cwd: string;

    constructor(cwd: string) {
        this.cwd = cwd;
        const events: ServiceEvents = {
            onTextChunk: (text) => this.emit({ event: "text-chunk", text }),
            onThinkingChunk: (text) => this.emit({ event: "thinking-chunk", text }),
            onToolCall: (name, args) => this.emit({ event: "tool-call", name, args: (args ?? {}) as Record<string, unknown> }),
            onToolResult: (name, ok, output) => this.emit({ event: "tool-result", name, ok, output }),
            onStepStart: (step, maxSteps) => this.emit({ event: "step-start", step, maxSteps }),
            onStepEnd: (step) => this.emit({ event: "step-end", step }),
            // `updateEvents` birleştirdiği için sohbet bitince bu geri yüklenmezse
            // `onError` bir sonraki hatada yanlış hedefe gider. Şimdiden tanımlı olmalı.
            onError: (err) => this.emit({ event: "error", message: err.message }),
            onModelLoadProgress: (pct) => this.emit({ event: "load-progress", pct }),
            onModelLoadComplete: () => this.emit({ event: "load-complete" })
        };
        this.baseEvents = events;
        this.service = new CoderioService(events, cwd);
    }

    get instance(): CoderioService {
        return this.service;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    get isBusy(): boolean {
        return this.busy;
    }

    private emit(event: EventFrame): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                /* dinleyici hatası istemciyi düşürmemeli */
            }
        }
    }

    /** Modele dokunan işlemleri sıraya alır; işlem bitene kadar bekler. */
    private exclusive<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(async () => {
            this.busy = true;
            try {
                return await task();
            } finally {
                this.busy = false;
            }
        });
        // Kuyruğun kendisi asla reddedilmesin; bir işlem hata verirse sonrakiler yine aksın.
        this.queue = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    // ── İşlemler ──

    /**
     * Sohbet gönderir. Çıktı akışı tek porta gider: motor paylaşılan, yanıt
     * akışı değil. Model yükleme ilerlemesi sohbetten bağımsız olduğu için
     * ayrıca biriktirilmez.
     */
    async sendMessage(
        text: string,
        modelId?: string
    ): Promise<{ ok: boolean; response?: string; steps?: number; error?: string }> {
        const task = this.exclusive(async () => {
            const chatEvents: ServiceEvents = {
                onTextChunk: (t) => this.emit({ event: "text-chunk", text: t }),
                onThinkingChunk: (t) => this.emit({ event: "thinking-chunk", text: t }),
                onToolCall: (name, args) => this.emit({ event: "tool-call", name, args: (args ?? {}) as Record<string, unknown> }),
                onToolResult: (name, ok, output) => this.emit({ event: "tool-result", name, ok, output }),
                onStepStart: (step, maxSteps) => this.emit({ event: "step-start", step, maxSteps }),
                onStepEnd: (step) => this.emit({ event: "step-end", step }),
                onError: (err) => this.emit({ event: "error", message: err.message }),
                onModelLoadProgress: (pct) => this.emit({ event: "load-progress", pct }),
                onModelLoadComplete: () => this.emit({ event: "load-complete" })
            };
            this.service.updateEvents(chatEvents);
            try {
                const result = await this.service.sendMessage(text, modelId);
                if (!result.ok) this.emit({ event: "error", message: result.error ?? "unknown error" });
                else this.emit({ event: "complete", response: result.response ?? "", steps: result.steps ?? 0 });
                return result;
            } finally {
                // Yayını taban yayına döndür: istek bittiğinde olaylar kalıcı
                // olarak sohbet tarafına bağlı kalmasın.
                this.service.updateEvents(this.baseEvents);
            }
        });

        // Yanıt tamamlanınca arkada duran başlığı üret: `complete` olayını
        // bekletmez, sıradaki sohbet isteğiyle çakışmaz (kuyruk seridir).
        void task.then(async () => {
            try {
                const title = await this.exclusive(() => this.service.refreshTitle());
                if (title) this.emit({ event: "session-title", title });
            } catch {
                /* başlık isteğe bağlıdır; hata görünmez */
            }
        });
        return task;
    }

    setConfig(patch: Record<string, unknown>): Promise<void> {
        return this.exclusive(() => this.service.setConfig(patch));
    }

    useModel(id: string): Promise<{ ok: boolean; error?: string }> {
        return this.exclusive(() => this.service.useModel(id));
    }

    installModel(id: string): Promise<{ ok: boolean; error?: string }> {
        return this.exclusive(() => this.service.installModel(id));
    }

    removeModel(id: string): Promise<{ ok: boolean; error?: string }> {
        return this.exclusive(() => this.service.removeModel(id));
    }

    refreshModels(): Promise<{ ok: boolean; count?: number; error?: string }> {
        return this.exclusive(() => this.service.refreshModels());
    }

    reset(): Promise<void> {
        return this.exclusive(() => this.service.reset());
    }

    /**
     * Kurulu modeli arka planda hazırlar (açılışta sıcak tutar).
     *
     * Kuyruğa girmez: kullanıcı yüklenirken mesaj gönderebilir; iki taraf aynı
     * paylaşılan oturum promise'ını bekler, çift motor kurulmaz. Model yoksa
     * sessizce başarısız döner ("installed:false" durumuna bırakır).
     */
    async warmUp(): Promise<{ ok: boolean; known: boolean }> {
        if (this.service.isWarm) {
            this.loadState = "ready";
            return { ok: true, known: true };
        }
        this.loadState = "loading";
        try {
            const result = await this.service.warmUp();
            this.loadState = this.service.isWarm ? "ready" : "idle";
            return result;
        } catch {
            this.loadState = "idle";
            return { ok: false, known: true };
        }
    }

    abort(): void {
        this.service.abort();
    }

    listModels() {
        return this.service.listModels();
    }

    listSessions() {
        return this.service.listSessions();
    }

    loadSession(id: string) {
        return this.service.loadSession(id);
    }

    saveSession(session: Parameters<CoderioService["saveSession"]>[0]) {
        return this.service.saveSession(session);
    }

    deleteSession(id: string) {
        return this.service.deleteSession(id);
    }

    getHistory(): HistoryMessage[] {
        return toHistoryMessages(this.service.getChatHistory());
    }

    setHistory(history: ChatHistoryItem[]): void {
        this.service.setChatHistory(history);
    }

    async status(): Promise<StatusReport> {
        const model = this.service.getModelInfo();
        const config = this.service.getConfig();
        return {
            protocol: PROTOCOL_VERSION,
            version: CODERIO_VERSION,
            modelId: config.modelId,
            modelName: model?.name ?? config.modelId,
            installed: model?.installed ?? false,
            loading: this.loadState === "loading",
            busy: this.busy,
            cwd: this.cwd,
            gpu: await buildGpuReport(this.service),
            context: this.service.getContextStats(),
            reasoning: this.service.getReasoningInfo(),
            config,
            uptimeSec: Math.round(process.uptime())
        };
    }

    async dispose(): Promise<void> {
        await this.service.dispose();
    }
}

/**
 * node-llama-cpp geçmişini istemciye gönderilebilir sade biçime çevirir.
 * Düşünme segmentleri ayrı `thought` mesajı olarak ayrılır; araç çağrıları
 * `tool` türüne düşer.
 */
export function toHistoryMessages(history: ChatHistoryItem[]): HistoryMessage[] {
    const out: HistoryMessage[] = [];
    for (const item of history) {
        if (item.type === "user") {
            out.push({ kind: "user", text: textOf(item.text) });
            continue;
        }
        if (item.type !== "model") continue;
        let text = "";
        let thought = "";
        for (const part of item.response) {
            if (typeof part === "string") {
                text += part;
                continue;
            }
            if (part.type === "segment") {
                if (part.segmentType === "thought") thought += part.text;
                else text += part.text;
                continue;
            }
            if (part.type === "functionCall") {
                out.push({ kind: "tool", text: part.name, name: part.name });
            }
        }
        if (thought) out.push({ kind: "thought", text: thought });
        if (text) out.push({ kind: "assistant", text });
    }
    return out;
}

function textOf(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
}
