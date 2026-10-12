/**
 * Motor istemcisi (renderer tarafı).
 *
 * `window.coderio` preload tarafından açılan tek yüzeydir; bu modül onu
 * sarar ve tüm bileşenlerin tek giriş noktası olur. Bileşenler doğrudan
 * `window.coderio` çağırmaz; böylece kanal biçimi değişirse tek dosya güncellenir.
 */
import type { CoderioApi, EventFrame, Request, Result, StatusReport } from "../../protocol/api.js";

function api(): CoderioApi {
    const bridge = window.coderio;
    if (!bridge) throw new Error("preload bridge not loaded");
    return bridge;
}

export type EngineListener = (event: EventFrame) => void;

/** Motor isteği gönderir; hata halinde reddeder. */
export function request<T extends Result = Result>(req: Request): Promise<T> {
    return api().request<T>(req);
}

/** Motor olaylarını dinler; döndürülen fonksiyon aboneliği bırakır. */
export function onEvent(listener: EngineListener): () => void {
    return api().onEvent(listener);
}

/** Motorun anlık durumu; motor çalışmıyorsa `null`. */
export async function status(): Promise<StatusReport | null> {
    try {
        const res = await request<Extract<Result, { type: "status" }>>({ type: "status" });
        return res.type === "status" ? res.status : null;
    } catch {
        return null;
    }
}

export const app = {
    info: () => api().app.info(),
    openFolder: () => api().app.openFolder(),
    revealDataDir: () => api().app.revealDataDir(),
    logPath: () => api().app.logPath(),
    restart: () => api().app.restart(),
    /** Çerçevesiz pencerenin denetim düğmeleri. */
    window: api().app.window
};
