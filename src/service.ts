import type { ChatHistoryItem } from "node-llama-cpp";
import { CoderioAgent, type AgentEvents } from "./core/agent.js";
import {
    loadConfig, saveConfig, getModelById, isModelInstalled,
    listInstalledModels as listInstalledFromDisk, removeModelFile,
    resolveModelFilePath, refreshRemoteModels, getModelsRegistry
} from "./config/configManager.js";
import {
    saveSession as saveSessionFile, loadSession as loadSessionFile,
    listSessions as listSessionsFromDisk, generateSessionId, deleteSession as deleteSessionFile
} from "./utils/sessions.js";
import type { StoredSession, StoredMessage } from "./utils/sessions.js";
import type { CoderioConfig, ModelDefinition, ReasoningMode } from "./config/types.js";
import { logger } from "./utils/paths.js";

export type ServiceEvents = AgentEvents & {
    onModelLoadProgress?: (pct: number) => void;
    onModelLoadComplete?: () => void;
};

/** İstemciye raporlanacak GPU durumu */
export type GpuStatus = {
    /** Gerçekte yüklenen arka uç; null ise model henüz yüklenmemiş */
    active: { backend: string; offload: boolean } | null;
    /** Kullanılabilen GPU belleği (MB) */
    vramMb: number;
    /** GPU'ya yüklenen katman sayısı (0 = henüz yüklenmedi) */
    layers: number;
    /** Bu makinede sürücüsü bulunan arka uçlar */
    supported: string[];
    /** config.gpu değeri */
    preferred: string;
    /** İstenen arka uç kullanılamayıp başka birine düşüldü mü */
    fallback: boolean;
};

export type ModelWithStatus = {
    model: ModelDefinition;
    path: string;
    installed: boolean;
    active: boolean;
};

export class CoderioService {
    private agent: CoderioAgent | null = null;
    private config: CoderioConfig;
    private events: ServiceEvents;
    private readonly cwd: string;
    private _active = false;
    private _currentAbort: AbortController | null = null;

    /** Şu an üzerinde çalışılan oturum dosyası kimliği (yoksa yenisi üretilir). */
    private recentSessionId: string | null = null;
    /** Oturumun ilk oluşturulma zamanı (dosya kimliğiyle birlikte sabit kalır). */
    private sessionCreatedAt: string | null = null;
    /** Yeni sohbetin başlığı (ilk kullanıcı mesajından) hâlâ üretilecek mi? */
    private titleNeedsGeneration = false;
    /** Başlık üretiminin kaynağı: sohbetin ilk kullanıcı mesajı. */
    private titleSource = "";
    /** Diskteki oturum adı: yüklü sohbette akıllı başlık korunur. */
    private storedTitle: string | null = null;

    constructor(events: ServiceEvents = {}, cwd?: string) {
        this.config = loadConfig();
        this.events = events;
        this.cwd = cwd ?? process.cwd();
    }

    // ── Agent Lifecycle ──

    private ensureAgent(): void {
        if (this.agent) return;
        this.agent = new CoderioAgent({
            config: this.config,
            cwd: this.cwd,
            events: {
                onTextChunk: this.events.onTextChunk,
                onThinkingChunk: this.events.onThinkingChunk,
                onToolCall: this.events.onToolCall,
                onToolResult: this.events.onToolResult,
                onComplete: this.events.onComplete,
                onStepStart: this.events.onStepStart,
                onStepEnd: this.events.onStepEnd,
                onContextTrimmed: this.events.onContextTrimmed,
                onError: this.events.onError
            },
            onLoadProgress: this.events.onModelLoadProgress,
            onLoadComplete: this.events.onModelLoadComplete
        });
    }

    /**
     * Event'leri güncelle ve aktif asistana anında uygula.
     *
     * Motor tek modeli paylaştığı için her sohbet isteğinin çıktısı yalnızca
     * soran istemciye gitmelidir; bu yüzden yalnızca saklamak yeterli değil,
     * asistanın kendi event'leri de güncellenmeli. `events` verilmezse mevcut
     * yayın korunur.
     */
    updateEvents(events: ServiceEvents): void {
        if (events) this.events = { ...this.events, ...events };
        this.agent?.setEvents(this.toAgentEvents());
    }

    /** ServiceEvents → CoderioAgent olay eşleyicisi (tek doğruluk kaynağı) */
    private toAgentEvents(): AgentEvents {
        const e = this.events;
        return {
            onTextChunk: e.onTextChunk,
            onThinkingChunk: e.onThinkingChunk,
            onToolCall: e.onToolCall,
            onToolResult: e.onToolResult,
            onComplete: e.onComplete,
            onStepStart: e.onStepStart,
            onStepEnd: e.onStepEnd,
            onContextTrimmed: e.onContextTrimmed,
            onError: e.onError
        };
    }

    // ── Prompt ──

    async sendMessage(message: string, modelId?: string): Promise<{
        ok: boolean; response?: string; steps?: number;
        completed?: boolean; error?: string;
    }> {
        if (this._active) return { ok: false, error: "Busy" };

        // Model değişikliği varsa
        if (modelId && modelId !== this.config.modelId) {
            this.config.modelId = modelId;
            saveConfig(this.config);
            await this.recreateAgent();
        }

        // Model indirilmemişse asistan kurma: aksi halde llama'nın ENOENT'si
        // kullanıcıya ham dosya yolu olarak sızıyor.
        const model = getModelById(this.config.modelId);
        if (!model) {
            return { ok: false, error: `Model not defined: ${this.config.modelId}. Refresh the model list and pick a model.` };
        }
        if (!isModelInstalled(model)) {
            return {
                ok: false,
                error: `"${model.name}" is not installed yet.\n` + `Install it from the Coderio UI: ${model.id}  →  ${resolveModelFilePath(model)}`
            };
        }

        this.ensureAgent();
        if (!this.agent) return { ok: false, error: "Failed to start agent" };

        this._active = true;
        const controller = new AbortController();
        this._currentAbort = controller;

        try {
            const result = await this.agent.promptTask(message, { signal: controller.signal });
            return {
                ok: true,
                response: result.response,
                steps: result.steps,
                completed: result.completed
            };
        } catch (err) {
            if (controller.signal.aborted) return { ok: false, error: "Aborted" };
            return { ok: false, error: (err as Error).message };
        } finally {
            if (this._currentAbort === controller) this._currentAbort = null;
            this._active = false;
            // Tur bitti: başarıyla veya iptalle sonuçlansın, sohbeti diske yaz.
            // Yeni bir oturumsa (içerik ilk kez yazılıyor) ilk kullanıcı mesajı
            // akıllı başlığın kaynağı olarak kilitlenir.
            const isNewSession = this.recentSessionId === null;
            await this.autosave();
            if (isNewSession && this.agent) {
                const firstUser = toStoredMessages(this.agent.getChatHistory()).find((m) => m.kind === "user");
                if (firstUser?.text) {
                    this.titleNeedsGeneration = true;
                    this.titleSource = firstUser.text;
                }
            }
        }
    }

    abort(): void {
        this._currentAbort?.abort();
    }

    async reset(): Promise<void> {
        // Yeni sohbetten önce mevcut turu kapat; sonra temizle.
        await this.autosave();
        this.agent?.resetConversation();
        this.recentSessionId = null;
        this.sessionCreatedAt = null;
        this.titleNeedsGeneration = false;
        this.titleSource = "";
        this.storedTitle = null;
    }

    /**
     * Kilitlenmiş ilk kullanıcı mesajından İngilizce akıllı başlığı üretir ve
     * oturum dosyasını onunla günceller. Üretilecek bir şey yoksa (ya da
     * başarısız olursa) `null` döner; başlık zorunlu değildir.
     */
    async refreshTitle(): Promise<string | null> {
        if (!this.titleNeedsGeneration || !this.agent || !this.titleSource) return null;
        this.titleNeedsGeneration = false;
        try {
            const title = await this.agent.generateTitle(this.titleSource);
            if (!title) return null;
            this.storedTitle = title;
            await this.autosave(title);
            return title;
        } catch (err) {
            logger.warn(`session title generation failed: ${String(err)}`);
            return null;
        }
    }

    /**
     * Kurulu modeli arka planda hazırlar (açılışta sıcak tutar).
     *
     * Model kurulu değilse sessizce başarısız olur — servisi bozmaz; açılışta
     * "Starting AJAN Engine…" yoluyla kullanıcı kurulum yapmaya yönlendirilir.
     */
    async warmUp(): Promise<{ ok: boolean; known: boolean }> {
        const model = getModelById(this.config.modelId);
        if (!model || !isModelInstalled(model)) return { ok: false, known: false };
        try {
            this.ensureAgent();
            await this.agent?.warmUp();
            return { ok: true, known: true };
        } catch (err) {
            return { ok: false, known: true };
        }
    }

    /** Model oturumu kurulu ve kullanıma hazır mı? */
    get isWarm(): boolean {
        return this.agent?.isWarm === true;
    }

    // ── History ──

    getChatHistory(): ChatHistoryItem[] {
        return this.agent?.getChatHistory() ?? [];
    }

    setChatHistory(history: ChatHistoryItem[]): void {
        this.agent?.setChatHistory(history);
    }

    getContextStats(): { usedTokens: number; contextSize: number } | null {
        return this.agent?.getContextStats() ?? null;
    }

    // ── Config ──

    getConfig(): CoderioConfig {
        return { ...this.config };
    }

    async setConfig(patch: Record<string, unknown>): Promise<void> {
        const merged = { ...this.config, ...patch } as CoderioConfig;
        if (patch.session && typeof patch.session === "object") {
            merged.session = { ...this.config.session, ...(patch.session as Record<string, unknown>) } as CoderioConfig["session"];
        }
        saveConfig(merged);
        this.config = merged;
        await this.recreateAgent();
    }

    // ── Projects ──

    listProjects(): { path: string; active: boolean }[] {
        const projects = this.config.projects ?? [];
        return projects.map(path => ({ path, active: path === this.config.activeProject }));
    }

    async addProject(path: string): Promise<{ ok: boolean; error?: string }> {
        const projects = this.config.projects ?? [];
        if (projects.includes(path)) return { ok: true };
        this.config.projects = [...projects, path];
        saveConfig(this.config);
        return { ok: true };
    }

    async removeProject(path: string): Promise<{ ok: boolean; error?: string }> {
        const projects = this.config.projects ?? [];
        this.config.projects = projects.filter(p => p !== path);
        if (this.config.activeProject === path) this.config.activeProject = undefined;
        saveConfig(this.config);
        return { ok: true };
    }

    async setActiveProject(path: string | null): Promise<{ ok: boolean; error?: string }> {
        if (path === null) {
            this.config.activeProject = undefined;
            saveConfig(this.config);
            return { ok: true };
        }
        const projects = this.config.projects ?? [];
        if (!projects.includes(path)) return { ok: false, error: `Project not registered: ${path}` };
        this.config.activeProject = path;
        saveConfig(this.config);
        return { ok: true };
    }

    // ── Models ──

    getModelInfo(): { modelId: string; name: string; installed: boolean } | null {
        const model = getModelById(this.config.modelId);
        if (!model) return null;
        return {
            modelId: model.id,
            name: model.name,
            installed: isModelInstalled(model)
        };
    }

    /**
     * Motorun gerçekten kullandığı arka uç + bu makinede bulunan seçenekler.
     * `active` null ise model henüz yüklenmemiştir; `options` yalnızca kurulu
     * build'de native paketi bulunan arka uçları içerir.
     */
    async getGpuStatus(): Promise<GpuStatus> {
        const active = this.agent?.activeGpu ?? null;
        const supported = await this.detectGpu();
        const preferred = this.config.gpu ?? "auto";
        // İstenen arka uç ile gerçekte yüklenen farklıysa geri düşüş yapılmıştır.
        // "auto" için fark normaldir: node-llama-cpp kendi sırasını uygular.
        const fallback = active != null && preferred !== "auto" && active.backend !== preferred;
        return {
            active: active ? { backend: active.backend, offload: active.offload } : null,
            vramMb: await this.agent?.gpuVramMb().catch(() => 0) ?? 0,
            layers: this.agent?.gpuLayersUsed ?? 0,
            supported,
            preferred,
            fallback
        };
    }

    /** Seçili modelin düşünme modu (katalog + kullanıcı geçersiz kılması) */
    getReasoningInfo(): { mode: ReasoningMode; enabled: boolean } | null {
        return this.agent?.reasoningInfo ?? null;
    }

    listModels(): ModelWithStatus[] {
        const installed = listInstalledFromDisk();
        return installed.map(item => ({
            model: item.model,
            path: item.path,
            installed: item.installed,
            active: item.model.id === this.config.modelId
        }));
    }

    async installModel(modelId: string): Promise<{ ok: boolean; error?: string }> {
        const model = getModelById(modelId);
        if (!model) return { ok: false, error: `Model not found: ${modelId}` };
        try {
            const { downloadModel } = await import("./engine/modelManager.js");
            await downloadModel(model, {
                onProgress: (progress) => {
                    const pct = progress.totalSize > 0
                        ? Math.round((progress.downloadedSize / progress.totalSize) * 100)
                        : progress.percent ?? 0;
                    this.events.onModelLoadProgress?.(pct);
                }
            });
            return { ok: true };
        } catch (err) {
            return { ok: false, error: (err as Error).message };
        }
    }

    async removeModel(modelId: string): Promise<{ ok: boolean; error?: string }> {
        const model = getModelById(modelId);
        if (!model) return { ok: false, error: `Model not found: ${modelId}` };
        const removed = removeModelFile(model);
        if (!removed) return { ok: false, error: "Model file not found" };

        // Aktif model silindiyse config'i temizle/kurulu bir modele geç
        if (this.config.modelId === modelId) {
            const installed = listInstalledFromDisk().find((m) => m.installed);
            if (installed) {
                this.config.modelId = installed.model.id;
                saveConfig(this.config);
                await this.recreateAgent();
            } else {
                // Kurulu model kalmadı: agent'ı öldür ama servisi ayakta bırak.
                // modelId boş bırakılıp recreateAgent() çağrılırsa servis kalıcı ölüyordu.
                const fallback = getModelsRegistry()[0];
                this.config.modelId = fallback?.id ?? "";
                saveConfig(this.config);
                this._currentAbort?.abort();
                this._currentAbort = null;
                await this.agent?.dispose();
                this.agent = null;
                this._active = false;
            }
        }
        return { ok: true };
    }

    async useModel(modelId: string): Promise<{ ok: boolean; error?: string }> {
        const model = getModelById(modelId);
        if (!model) return { ok: false, error: `Model not found: ${modelId}` };
        if (!isModelInstalled(model)) return { ok: false, error: `Model not installed: ${modelId}` };
        this.config.modelId = modelId;
        saveConfig(this.config);
        await this.recreateAgent();
        return { ok: true };
    }

    async refreshModels(): Promise<{ ok: boolean; count?: number; error?: string }> {
        try {
            const models = await refreshRemoteModels();
            return { ok: true, count: models.length };
        } catch (err) {
            return { ok: false, error: (err as Error).message };
        }
    }

    getModelsRegistry() {
        return getModelsRegistry();
    }

    // ── Sessions ──

    async saveSession(session: StoredSession): Promise<void> {
        await saveSessionFile(session);
    }

    async loadSession(id: string): Promise<StoredSession | null> {
        const data = await loadSessionFile(id);
        if (data && this.agent) {
            this.agent.setChatHistory(data.history);
            // Ardından gelen mesajlar bu oturum dosyasında devam eder.
            this.recentSessionId = data.id;
            this.sessionCreatedAt = data.createdAt;
            // Başlık dosyadan gelir; yeniden üretilmez, yeniden yazılırken korunur.
            this.titleNeedsGeneration = false;
            this.titleSource = "";
            this.storedTitle = data.title;
        }
        return data;
    }

    async listSessions(): Promise<StoredSession[]> {
        return await listSessionsFromDisk();
    }

    async deleteSession(id: string): Promise<void> {
        await deleteSessionFile(id);
    }

    generateSessionId(): string {
        return generateSessionId();
    }

    // ── GPU ──

    async detectGpu(): Promise<string[]> {
        try {
            const { LlamaEngine } = await import("./engine/llama.js");
            return await LlamaEngine.detectSupportedGpus();
        } catch {
            return [];
        }
    }

    // ── Status ──

    get isActive(): boolean {
        return this._active;
    }

    // ── Internal ──

    /**
     * Mevcut sohbeti diske yazar (auto-save).
     *
     * Boş/ısınma oturumları kaydedilmez: en az bir kullanıcı mesajı gerekir.
     * Aynı oturum devam ettiği sürece aynı kimliğe yazılır; başlık ilk kullanıcı
     * mesajından üretilir. `sendMessage`, `reset`, `recreateAgent` (model/config
     * değişimi) ve `dispose` buradan geçer; böylece kapatmada asla kayıp olmaz.
     */
    private async autosave(titleOverride?: string): Promise<void> {
        if (!this.agent) return;
        const history = this.agent.getChatHistory();
        const messages = toStoredMessages(history);
        const firstUser = messages.find((m) => m.kind === "user");
        if (!firstUser) return;

        const now = new Date().toISOString();
        const id = this.recentSessionId ?? generateSessionId();
        this.recentSessionId = id;
        if (!this.sessionCreatedAt) this.sessionCreatedAt = now;

        await saveSessionFile({
            id,
            title: titleOverride ?? this.storedTitle ?? sessionTitle(firstUser.text),
            mode: "chat",
            createdAt: this.sessionCreatedAt,
            updatedAt: now,
            history,
            messages
        });
    }

    private async recreateAgent(): Promise<void> {
        // Model/config değişmeden önce o anda yazılmamış bir tur kalmasın.
        await this.autosave();
        await this.agent?.dispose();
        this.agent = null;
        this.ensureAgent();
        // Yeni asistan sıfır geçmişle başlar: sonraki mesaj yeni oturumdur.
        this.recentSessionId = null;
        this.sessionCreatedAt = null;
    }

    async dispose(): Promise<void> {
        await this.autosave();
        this._currentAbort?.abort();
        await this.agent?.dispose();
        this.agent = null;
    }
}

/** İlk kullanıcı mesajından oturum başlığı üretir (kısa). */
function sessionTitle(firstUserText: string | undefined): string {
    const line = (firstUserText ?? "New chat").split("\n")[0]?.trim() ?? "New chat";
    return line.length > 60 ? `${line.slice(0, 60)}…` : line || "New chat";
}

/**
 * node-llama-cpp geçmişini saklanabilir `StoredMessage` biçimine çevirir.
 * Düşünme segmentleri ayrı `thought`, araç çağrıları `tool` olarak düşer.
 */
export function toStoredMessages(history: ChatHistoryItem[]): StoredMessage[] {
    const out: StoredMessage[] = [];
    for (const item of history) {
        if (item.type === "user") {
            const value = typeof item.text === "string" ? item.text : JSON.stringify(item.text);
            out.push({ kind: "user", text: value });
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
                out.push({ kind: "tool", name: part.name });
            }
        }
        if (thought) out.push({ kind: "thought", text: thought });
        if (text) out.push({ kind: "assistant", text });
    }
    return out;
}
