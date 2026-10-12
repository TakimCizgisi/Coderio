/**
 * Coderio ana süreci.
 *
 * Yaşam döngüsü: tek örnek kilidi -> motoru başlat -> pencereyi aç -> çıkışta
 * motoru kapat. Motor bir `utilityProcess` alt sürecidir ve uygulama onunla
 * yalnızca süreç içi `MessagePort` üzerinden konuşur; dışa açık port yoktur.
 */
import { app, BrowserWindow, dialog } from "electron";
import { createWindow } from "./window.js";
import { startIpc } from "./ipc.js";
import type { EngineHost } from "./engineHost.js";
import { logger } from "../utils/paths.js";
import { CODERIO_VERSION, CODENAME } from "../version.js";
import { WINDOW_STATE_CHANNEL } from "../protocol/channels.js";

const PRODUCT = "Coderio";

let mainWindow: BrowserWindow | null = null;
let host: EngineHost | undefined;

/** `getWindow` tembel çözümleyici: pencere henüz oluşmamış olabilir. */
const getWindow = (): BrowserWindow | null => mainWindow;

/**
 * Pencereyi açar ve maksimum durumunu renderer'a yayınlar.
 *
 * Çerçevesiz pencerede renderer kendi düğmelerini çizdiği için, düğmenin
 * hangi görünümü göstermesi gerektiğini ana süreç bildirir.
 */
function openMainWindow(): void {
    mainWindow = createWindow((maximized) => {
        mainWindow?.webContents.send(WINDOW_STATE_CHANNEL, maximized);
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

// Tek örnek: ikinci bir Coderio açılmaz, mevcut pencere öne getirilir.
if (!app.requestSingleInstanceLock()) {
    app.exit(0);
}

app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
});

app.whenReady().then(async () => {
    logger.info(`${PRODUCT} ${CODERIO_VERSION} "${CODENAME}" starting (pid ${process.pid})`);
    // `modelId` yalnızca varsayılan öneridir; kullanıcının config'i önceliklidir.
    openMainWindow();
    host = await startIpc(getWindow);

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
    });
});

// macOS'ta tüm pencereler kapanınca uygulama çalışmaya devam eder; Windows
// ve Linux'ta kapanış uygulamayı da bitirir.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
    if (!host) return;
    // Motor kapanmadan süreç bitmesin: model belleği temizce bırakılsın.
    event.preventDefault();
    const pending = host;
    host = undefined;
    void pending.stop().finally(() => app.exit(0));
});

process.on("uncaughtException", (err) => {
    logger.error(`main process error: ${err.stack ?? err.message}`);
    if (mainWindow) {
        dialog.showErrorBox(`${PRODUCT} error`, err.message);
    }
});
