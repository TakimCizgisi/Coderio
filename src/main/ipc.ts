/**
 * Ana sürecin IPC köprüsü.
 *
 * Renderer'ın istekleri burada `EngineChannel` üzerinden motora iletilir, motor
 * olayları da buradan `webContents.send` ile renderer'a geri gönderilir.
 * Renderer'ın erişebildiği tek köprü budur; doğrudan `net`/`fs` yoktur.
 */
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { EngineHost } from "./engineHost.js";
import { CODERIO_VERSION, CODENAME } from "../version.js";
import { getDataDir, getLogDir, logger } from "../utils/paths.js";
import type { Request } from "../protocol/api.js";
import { EVENT_CHANNEL, REQUEST_CHANNEL } from "../protocol/channels.js";

/**
 * Köprüyü kurar ve motoru başlatır.
 *
 * `getWindow` tembel çağrılır: motor olayları pencere hazır olmadan önce de
 * gelebilir, o an gönderim sessizce düşer.
 */
export async function startIpc(getWindow: () => BrowserWindow | null): Promise<EngineHost> {
    const host = new EngineHost(
        {
            onEvent: (event) => {
                getWindow()?.webContents.send(EVENT_CHANNEL, event);
            },
            onClose: (reason) => {
                logger.warn(`engine closed: ${reason}`);
                // Renderer'a haber ver: motorun öldüğünü bilsin, kullanıcı
                // bekleyen bir istekte asılı kalmasın.
                getWindow()?.webContents.send(EVENT_CHANNEL, { event: "log", level: "error", message: `engine closed: ${reason}` });
            }
        },
        process.cwd()
    );

    registerHandlers(host, getWindow);

    try {
        await host.ensure();
    } catch (err) {
        logger.error(`engine failed to start: ${String(err)}`);
    }
    return host;
}

function registerHandlers(host: EngineHost, getWindow: () => BrowserWindow | null): void {
    /** Motor isteği; hata durumunda preload'a `{ ok: false, error }` döner. */
    ipcMain.handle(REQUEST_CHANNEL, async (_e, req: Request) => {
        try {
            const channel = await host.ensure();
            return await channel.request(req);
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    ipcMain.handle("coderio:app-info", () => ({
        version: app.getVersion(),
        codename: CODENAME,
        platform: process.platform
    }));

    /** Klasör seçer ve motoru yeni dizinde yeniden başlatır. */
    ipcMain.handle("coderio:open-folder", async () => {
        const win = getWindow();
        const result = win
            ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
            : await dialog.showOpenDialog({ properties: ["openDirectory"] });
        const picked = result.canceled ? undefined : result.filePaths[0];
        if (!picked) return null;
        await switchProject(host, picked);
        return picked;
    });

    ipcMain.handle("coderio:reveal-data-dir", () => {
        shell.openPath(getDataDir());
    });

    ipcMain.handle("coderio:log-path", () => path.join(getLogDir(), "coderio.log"));

    ipcMain.handle("coderio:restart", async () => {
        await host.stop();
        app.relaunch();
        app.exit(0);
    });

    // Çerçevesiz pencere: denetim düğmeleri renderer'da görsel, eylem burada.
    ipcMain.handle("coderio:win-minimize", () => getWindow()?.minimize());
    ipcMain.handle("coderio:win-toggle-maximize", () => {
        const win = getWindow();
        if (!win) return;
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
    });
    ipcMain.handle("coderio:win-close", () => getWindow()?.close());
    ipcMain.handle("coderio:win-is-maximized", () => getWindow()?.isMaximized() ?? false);
}

/**
 * Çalışma dizinini değiştirir.
 *
 * Model belleği ve oturum geçmişi sürece bağlı olduğu için motor durdurulup
 * yeni dizinle yeniden başlatılır; yeniden başlatmadan `setCwd` yalnızca bir
 * sonraki açılışa etki eder.
 */
export async function switchProject(host: EngineHost, cwd: string): Promise<void> {
    logger.info(`switching project: ${cwd}`);
    await host.stop();
    host.setCwd(cwd);
    await host.ensure();
}
