/**
 * Sohbet geçmişi paneli.
 *
 * Oturumlar motorda otomatik kaydedilir (her turun sonunda, yeni sohbette ve
 * kapanışta). Bu panel `list-sessions` ile özetleri çeker; her satırda oturumu
 * yüklemek (Load) veya silmek (Delete) için eylemler sunar. Başlıkta arama
 * kutusu listeyi istemci tarafında filtreler.
 */
import { el, mount, clear } from "../../core/dom.js";
import { icon, ICONS } from "../../core/icons.js";
import { request } from "../../core/engine.js";
import type { Result, SessionSummary } from "../../../protocol/api.js";

export type HistoryOverlay = {
    open: () => void;
    close: () => void;
    root: HTMLElement;
};

export type HistoryOverlayOptions = {
    /** Paneldeki "New chat" eylemi. */
    onNewChat: () => void;
    /** Oturum yüklendiğinde çağrılır (mesajlar panelin karşılığında çizilir). */
    onLoad: (session: NonNullable<Extract<Result, { type: "session" }>["session"]>) => void;
};

export function HistoryOverlay(options: HistoryOverlayOptions): HistoryOverlay {
    const root = el("div.history-overlay", {}, el("div.settings-scrim"));
    const search = el("input", { type: "text", class: "history-search", placeholder: "Search conversations…" }) as HTMLInputElement;
    const list = el("div.settings-list.history-list");

    const newChatButton = el("button", { type: "button", class: "settings-action", text: "New chat" });
    const closeButton = el("button", { type: "button", class: "settings-close", "aria-label": "Close history" }, icon(ICONS.close));
    const panel = el(
        "section.menu-panel.history-panel",
        {},
        el("header.settings-header", {}, el("span.settings-title", { text: "History" }), closeButton),
        el("div.history-toolbar", {}, search, newChatButton),
        list
    );
    mount(root, panel);
    // Uygulama açılışında görünmemelidir; yalnızca `open()` ile gösterilir.
    root.hidden = true;

    let sessions: SessionSummary[] = [];

    async function refresh(): Promise<void> {
        const res = await request<Extract<Result, { type: "sessions" }>>({ type: "list-sessions" }).catch(() => null);
        sessions = res?.type === "sessions" ? res.sessions : [];
        render();
    }

    function render(): void {
        const query = search.value.trim().toLowerCase();
        clear(list);
        const filtered = query ? sessions.filter((s) => s.title.toLowerCase().includes(query)) : sessions;
        if (filtered.length === 0) {
            mount(
                list,
                el("div.settings-empty", { text: sessions.length === 0 ? "No conversations yet." : "No matching conversations." })
            );
            return;
        }
        for (const session of filtered) mount(list, row(session));
    }

    function row(session: SessionSummary): HTMLElement {
        const title = el("div.settings-item-name", { text: session.title });
        const meta = el("div.settings-item-meta", { text: new Date(session.updatedAt).toLocaleString() });
        const actions = el("div.settings-item-actions");
        const load = el("button", { type: "button", class: "settings-action", text: "Load" });
        load.addEventListener("click", () => void loadSession(session.id));
        const delBtn = el("button", { type: "button", class: "settings-action", text: "Delete" });
        delBtn.addEventListener("click", () => void del(session.id));
        actions.append(load, delBtn);
        return el("div.settings-item", {}, el("div.settings-item-main", {}, title, meta), actions);
    }

    async function loadSession(id: string): Promise<void> {
        const res = await request<Extract<Result, { type: "session" }>>({ type: "load-session", id }).catch(() => null);
        close();
        if (res?.type === "session" && res.ok && res.session) options.onLoad(res.session);
    }

    async function del(id: string): Promise<void> {
        await request({ type: "delete-session", id }).catch(() => null);
        await refresh();
    }

    search.addEventListener("input", render);
    newChatButton.addEventListener("click", () => {
        close();
        options.onNewChat();
    });
    closeButton.addEventListener("click", close);
    root.querySelector(".settings-scrim")?.addEventListener("pointerdown", close);
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
    });

    function open(): void {
        root.hidden = false;
        void refresh();
    }
    function close(): void {
        root.hidden = true;
    }

    return { open, close, root };
}