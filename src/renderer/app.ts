/**
 * Renderer giriş noktası.
 *
 * Sorumluluğu bağlamak: motor olaylarını dinle, durumu iste, `Home` bileşenini
 * kur. Arayüz kararları bileşenlerde; burada yalnızca motor çağrıları yapılır.
 *
 * İlk çizimden önce motorun durumu ve yazı tipleri beklenir: kullanıcı açılışta
 * eksik arayüz görmek istemiyor. Bekleme sonsuza kadar sürmesin diye her istek
 * `withTimeout` ile sınırlanır; motor geç başlasa da ekran yine açılır.
 */
import "./styles/app.css";
import { Home, projectLabel, type HomeView } from "./components/Home/index.js";
import type { DropdownItem } from "./components/Home/Dropdown.js";
import { SettingsOverlay } from "./components/Settings/SettingsOverlay.js";
import { MenuPanel } from "./components/Panels/MenuPanel.js";
import { HistoryOverlay } from "./components/Panels/HistoryOverlay.js";
import { app as appApi, onEvent, request, status } from "./core/engine.js";
import type { StoredSession, StatusReport } from "../protocol/api.js";

/** Motor isteklerinin bekleneceği en uzun süre (ms). */
const REQUEST_TIMEOUT_MS = 20_000;

const root = document.getElementById("app");

let current: StatusReport | null = null;
/** Winbar ortasında görünen aktif oturum adı. */
let sessionTitle = "New Chat";
let home: HomeView | null = null;

/** Ayarlar penceresi tek örnek; `Home` yeniden kurulsa da kalıcıdır. */
const settingsOverlay = SettingsOverlay();
/** Menü paneli (hamburger). İçerik her açılışta tazelenir. */
const menuPanel = MenuPanel(() => menuItems());
/** Sohbet geçmişi paneli. */
const historyOverlay = HistoryOverlay({
    onNewChat: () => void newChat(),
    onLoad: (session: StoredSession) => {
        sessionTitle = session.title;
        home?.setSessionTitle(session.title);
        home?.restoreSession(session.messages);
    }
});

document.body.append(settingsOverlay.root, menuPanel.root, historyOverlay.root);

/* ── Giriş ── */

async function main(): Promise<void> {
    if (!root) throw new Error("#app not found");

    // İkon fontu ilk çizimde henüz yüklenmemişse ligatur metinleri ("menu")
    // bir an görünür. Yazı tipleri hazır olmadan çizim yapılmaz.
    await fontsReady();

    onEvent((event) => {
        // Akıllı başlık üretilince winbar ortası ve oturum adı güncellenir.
        if (event.event === "session-title") sessionTitle = event.title;
        home?.pushEvent(event);
    });

    current = await withTimeout(status(), REQUEST_TIMEOUT_MS).catch(() => null);
    render();
    setInterval(() => void refreshStatus(), 5000);
}

function render(): void {
    if (!root) return;

    home = Home({
        title: sessionTitle,
        project: projectLabel(current),
        status: current,
        projectItems: projectItems(),
        onOpenMenu: () => menuPanel.open(),
        onSend: (text) => void send(text),
        onStop: () => void stopGenerating()
    });
    root.replaceChildren(home);
}

/* ── Menü ── */

function menuItems(): DropdownItem[] {
    return [
        { key: "new-chat", label: "New chat", onSelect: () => void newChat() },
        { key: "history", label: "History…", onSelect: () => historyOverlay.open() },
        { key: "settings", label: "Settings…", onSelect: () => settingsOverlay.open() },
        { key: "reveal-data-dir", label: "Open data directory", onSelect: () => void appApi.revealDataDir() },
        { key: "restart", label: "Restart", onSelect: () => void appApi.restart() },
        { key: "quit", label: "Quit", onSelect: () => void window.coderio.app.window.close() }
    ];
}

function projectItems(): DropdownItem[] {
    return [
        {
            key: "open-folder",
            label: "Open folder…",
            onSelect: () => void openFolder()
        },
        {
            key: "current",
            label: current ? `Open: ${current.cwd}` : "Open: —",
            disabled: true
        }
    ];
}

/* ── Motor eylemleri ── */

async function send(text: string): Promise<void> {
    if (!home) return;
    home.pushUser(text);
    home.prompt.reset();

    try {
        await request({ type: "chat", text });
    } catch (err) {
        home.pushEvent({ event: "error", message: describeError(err) });
    }
    await refreshStatus();
}

async function newChat(): Promise<void> {
    home?.clearOutput();
    sessionTitle = "New Chat";
    home?.setSessionTitle("New Chat");
    try {
        await request({ type: "new-chat" });
    } catch (err) {
        home?.pushEvent({ event: "error", message: describeError(err) });
    }
}

async function stopGenerating(): Promise<void> {
    try {
        await request({ type: "abort" });
    } catch (err) {
        home?.pushEvent({ event: "error", message: describeError(err) });
    }
    await refreshStatus();
}

async function openFolder(): Promise<void> {
    // Klasör seçici kullanıcı bekler; bu yüzden süre sınırı diğerlerinden uzun.
    const picked = await withTimeout(appApi.openFolder(), 5 * 60_000).catch(() => null);
    if (!picked) return;
    await refreshStatus();
    // Proje adı düğmenin etiketidir; menü de güncel yolu göstersin diye tüm
    // ekran yeniden kurulur (çıktı listesi korunur).
    render();
}

async function refreshStatus(): Promise<void> {
    current = await status();
    if (!home) return;
    home.applyStatus(current);
    home.prompt.setProject(projectLabel(current));
}

/* ── Yardımcılar ── */

/** İstek verilmezse ekran hiç açılmaz; bu yüzden her bekleme sınırlıdır. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

/**
 * Yazı tipleri hazır olana kadar bekle.
 *
 * `document.fonts.ready` yalnızca o anda kullanılmakta olan yüzleri bekler;
 * ikon fontu CSS'te tanımlı olduğu için ilk çizimde listede yer alır. Font
 * yine de yüklenemezse (dosya eksik) bekleme süresiz kalır ve arayüz yine açılır.
 */
function fontsReady(): Promise<void> {
    if (!document.fonts) return Promise.resolve();
    return withTimeout(document.fonts.ready.then(() => undefined), 5_000).catch(() => undefined);
}

function describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

void main();