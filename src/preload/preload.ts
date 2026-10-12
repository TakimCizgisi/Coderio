/**
 * Renderer'ın kullanabileceği tek API — renderer için Electron API'si değil.
 *
 * Renderer yalnızca `window.coderio` nesnesini görür: dosya sistemi, süreç,
 * ağ ya da `ipcRenderer` doğrudan erişimi yoktur. Her çağrı ana sürece
 * `invoke` ile gider, motor işleri orada `EngineChannel` üzerinden yapılır.
 *
 * Bu dosya sandbox'ı aşmak zorunda olduğu için CJS olarak derlenir
 * (`dist/preload.js`); `require("electron")` kullanılabilir olmalıdır.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { CoderioApi, EventFrame, Request, Result } from "../protocol/api.js";
import { EVENT_CHANNEL, REQUEST_CHANNEL, WINDOW_STATE_CHANNEL } from "../protocol/channels.js";

/** `Result` tipi çalışma zamanında değer değildir; yalnızca doğrulama için. */
function assertKnownRequest(req: unknown): asserts req is Request {
    if (!req || typeof req !== "object" || typeof (req as Request).type !== "string") {
        throw new Error("invalid request");
    }
}

const api: CoderioApi = {
    /** Motor isteği gönderir; hata durumunda çöker, çünkü tipi `Result` taşır. */
    async request<T extends Result = Result>(req: Request): Promise<T> {
        assertKnownRequest(req);
        const res = (await ipcRenderer.invoke(REQUEST_CHANNEL, req)) as
            | { ok: true; result: T }
            | { ok: false; error: string };
        if (!res.ok) throw new Error(res.error);
        return res.result;
    },

    /** Motor olaylarını dinler; `off` ile aboneliği bırakır. */
    onEvent(listener: (event: EventFrame) => void): () => void {
        const wrapped = (_e: IpcRendererEvent, event: EventFrame) => listener(event);
        ipcRenderer.on(EVENT_CHANNEL, wrapped);
        return () => {
            ipcRenderer.off(EVENT_CHANNEL, wrapped);
        };
    },

    /** Ana süreçte çalışan, renderer'a özel işlemler (klasör seçme, sürüm). */
    app: {
        info: () => ipcRenderer.invoke("coderio:app-info") as Promise<{ version: string; codename: string; platform: string }>,
        openFolder: () => ipcRenderer.invoke("coderio:open-folder") as Promise<string | null>,
        revealDataDir: () => ipcRenderer.invoke("coderio:reveal-data-dir") as Promise<void>,
        logPath: () => ipcRenderer.invoke("coderio:log-path") as Promise<string>,
        restart: () => ipcRenderer.invoke("coderio:restart") as Promise<void>,

        /** Çerçevesiz pencerenin denetimi; renderer doğrudan `BrowserWindow` görmez. */
        window: {
            minimize: () => ipcRenderer.invoke("coderio:win-minimize") as Promise<void>,
            toggleMaximize: () => ipcRenderer.invoke("coderio:win-toggle-maximize") as Promise<void>,
            close: () => ipcRenderer.invoke("coderio:win-close") as Promise<void>,
            isMaximized: () => ipcRenderer.invoke("coderio:win-is-maximized") as Promise<boolean>,
            onStateChange: (listener: (maximized: boolean) => void) => {
                const wrapped = (_e: IpcRendererEvent, maximized: boolean) => listener(maximized);
                ipcRenderer.on(WINDOW_STATE_CHANNEL, wrapped);
                return () => {
                    ipcRenderer.off(WINDOW_STATE_CHANNEL, wrapped);
                };
            }
        }
    }
};

contextBridge.exposeInMainWorld("coderio", api);
