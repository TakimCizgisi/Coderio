/**
 * Renderer sözleşmesi — preload, ana süreç ve arayüz aynı tipleri görür.
 *
 * Bu dosya çalışma zamanında yalnızca tip içerir; motor protokolünün ince bir
 * yeniden dışa aktarımıdır. Böylece preload CJS olarak derlense bile tip
 * tarafında tek doğruluk kaynağı korunur.
 *
 * Not: `messages.ts` bu tipleri içe aktarır ama dışa aktarmaz; bu yüzden
 * dışa aktarım gerçek tanım modüllerinden yapılır.
 */
export type {
    GpuReport,
    HistoryMessage,
    ModelEntry,
    SessionSummary,
    StatusReport,
    Request,
    RequestType,
    Result,
    EventFrame,
    EventName
} from "./messages.js";

export { PROTOCOL_VERSION } from "./messages.js";

export type { CoderioConfig, GpuBackend, ModelDefinition, ReasoningMode, SessionConfig } from "../config/types.js";
export type { StoredMessage, StoredSession, TodoItem } from "../utils/sessions.js";

import type { EventFrame, Request, Result } from "./messages.js";

/** Renderer'ın çağırabileceği uygulama işlemleri. */
export type AppInfo = {
    version: string;
    codename: string;
    platform: string;
};

/** Çerçevesiz pencerenin denetim düğmeleri. */
export type WindowApi = {
    minimize(): Promise<void>;
    /** Maksimuma alır veya eski boyutuna döndürür. */
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    /** Maksimum durum değişince çağrılır; aboneliği bırakan işlev döner. */
    onStateChange(listener: (maximized: boolean) => void): () => void;
};

export type AppApi = {
    info(): Promise<AppInfo>;
    /** Klasör seçici açar; iptal edilirse `null`. */
    openFolder(): Promise<string | null>;
    /** Veri dizinini dosya gezgininde gösterir. */
    revealDataDir(): Promise<void>;
    logPath(): Promise<string>;
    /** Uygulamayı (motor dahil) yeniden başlatır. */
    restart(): Promise<void>;
    window: WindowApi;
};

/** `window.coderio` — renderer'ın gördüğü tek yüzey. */
export type CoderioApi = {
    /** Motor isteği gönderir. Motor hata döndürürse bu çağrı reddedilir. */
    request<T extends Result = Result>(req: Request): Promise<T>;
    /** Motor olaylarını dinler; döndürülen fonksiyon aboneliği bırakır. */
    onEvent(listener: (event: EventFrame) => void): () => void;
    app: AppApi;
};

declare global {
    interface Window {
        coderio: CoderioApi;
    }
}
