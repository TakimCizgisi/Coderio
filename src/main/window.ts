/**
 * Ana pencere.
 *
 * Güvenli varsayılanlar: `contextIsolation` açık, `nodeIntegration` kapalı,
 * sandbox açık. Renderer yalnızca `preload.cjs` üzerinden `window.coderio`
 * API'sini görür. Uzak içerik yüklenmez; pencere `dist/renderer/index.html`
 * dosyasından açılır.
 *
 * Pencere çerçevesizdir (`frame: false`): başlık çubuğu renderer tarafında
 * çizilir ve minimize/maksimum/kapat düğmeleri `ipcMain` üzerinden buraya gelir.
 * Bedeli, Windows'un yerel "Snap Layout" menüsünün kaybolmasıdır.
 */
import { BrowserWindow, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function distDir(): string {
    return path.dirname(fileURLToPath(import.meta.url));
}

/** Arayüz paletiyle aynı zemin rengi; yükleme sırasında beyaz flaşı önler. */
const BACKGROUND = "#121212";

export function createWindow(onStateChange?: (maximized: boolean) => void): BrowserWindow {
    const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 720,
        minHeight: 560,
        show: false,
        frame: false,
        autoHideMenuBar: true,
        backgroundColor: BACKGROUND,
        title: "Coderio",
        icon: appIconPath(),
        webPreferences: {
            // `.cjs`: paket "type": "module" olduğu için preload uzantısı CJS olmalı.
            preload: path.join(distDir(), "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });

    // `ready-to-show`: beyaz boşluk yerine dolu pencere gösterilir.
    win.once("ready-to-show", () => win.show());

    // Renderer'daki özel düğmeler kendi ikonunu çizer; aynı zamanda yerleşik
    // pencere düğmelerini gizlenmiş bırakıyoruz (bazı Windows sürümlerinde
    // çerçevesiz pencerede menü şeridi görünür).
    win.setMenuBarVisibility(false);

    if (onStateChange) {
        const publish = (): void => onStateChange(win.isMaximized());
        win.on("maximize", publish);
        win.on("unmaximize", publish);
        win.on("enter-full-screen", publish);
        win.on("leave-full-screen", publish);
    }

    // Dış bağlantılar uygulama içinde değil, varsayılan tarayıcıda açılır.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
        const current = win.webContents.getURL();
        if (url !== current) {
            event.preventDefault();
            if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        }
    });

    void win.loadFile(path.join(distDir(), "renderer", "index.html"));
    return win;
}

/** Windows için `.exe` gömülü ikonu; yoksa `undefined` (Electron varsayılanı). */
function appIconPath(): string | undefined {
    const ico = path.join(distDir(), "..", "build", "icon.ico");
    return existsSync(ico) ? ico : undefined;
}
