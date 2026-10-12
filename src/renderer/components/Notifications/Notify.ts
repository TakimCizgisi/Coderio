/**
 * Geçici bildirim (toast) kutusu.
 *
 * Sağ duvarın en altında, küçük bir kutu olarak belirir (VSCode mesaj kutusu
 * gibi, kendi sohbet kutusu tasarımımıza uygun). Her toast solda seviye ikonunu
 * (renkli) ve hemen sağında mesajı gösterir; birkaç saniye sonra kendini siler.
 * Kalıcı şerit değildir, layout'a hiç karışmaz.
 *
 * Model yüklemede tek "sıcak" toast vardır: `boot` ile "Starting AJAN Engine…"
 * doğar, `progress` ile "Loading model… %" olur, `ready` ile başarıya dönüşüp
 * kaybolur (aynı kutu, aynı yerde gelişir).
 */
import { el, mount } from "../../core/dom.js";
import { icon, ICONS } from "../../core/icons.js";

export type NotifyKind = "info" | "success" | "warning" | "error";

export type NotifyView = {
    root: HTMLElement;
    /** Bilgi toast'ı gösterir. */
    info: (message: string) => void;
    /** Uyarı toast'ı gösterir. */
    warn: (message: string) => void;
    /** Hata toast'ı gösterir. */
    error: (message: string) => void;
    /** Başarı toast'ı gösterir. */
    success: (message: string) => void;
    /** "Starting AJAN Engine…" yükleme toast'ını başlatır. */
    boot: () => void;
    /** Yükleme toast'ını "Loading model… %" olarak günceller. */
    progress: (pct: number) => void;
    /** Yükleme toast'ını başarıya çevirir (ör. "AJAN Engine Started."). */
    ready: (message: string) => void;
};

const KIND_ICON: Record<NotifyKind, string> = {
    info: ICONS.info,
    success: ICONS.success,
    warning: ICONS.warning,
    error: ICONS.error
};

/** Sevîye başına gizlenme süresi (ms). */
const DURATION: Record<NotifyKind, number> = {
    info: 3500,
    success: 4000,
    warning: 5000,
    error: 6000
};

/** Yükleme toast'ı hiç olay gelmezse uzun süre kalmamalı (ms). */
const LOAD_TTL = 8000;

/** Aynı anda görünen en çok toast. */
const MAX_VISIBLE = 4;

/** Aynı seviye+mesajın bu süre içinde tekrar basılmaması için ms. */
const DEDUP_MS = 4000;

/** Seviye+mesaj → son basılma zamanı; gereksiz tekrarları bastırır. */
const recent = new Map<string, number>();

/** Aynı toast kısa pencerede yinelendi mi? (Yükleme toast'ları etkilenmez.) */
function isDuplicate(kind: NotifyKind, message: string): boolean {
    if (!message) return false;
    const now = Date.now();
    const key = `${kind}\u0000${message}`;
    const last = recent.get(key);
    if (last !== undefined && now - last < DEDUP_MS) return true;
    recent.set(key, now);
    for (const [k, t] of recent) if (now - t > DEDUP_MS) recent.delete(k);
    return false;
}

export function Notify(): NotifyView {
    const root = el("div.toasts");
    let loadToast: ToastHandle | null = null;

    type ToastHandle = {
        node: HTMLElement;
        set: (kind: NotifyKind, message: string, ttl: number) => void;
        hide: () => void;
    };

    function makeToast(kind: NotifyKind, message: string, ttl: number, dedup = true): ToastHandle {
        // Yalnızca geçici tostlar tekilleştirilir: aynı olay sık geldiğinde
        // (ör. yüklenme ilerlemeleri) ekranı tekrar mesajla kaplamaz.
        if (dedup && ttl > 0 && isDuplicate(kind, message)) {
            return { node: el("div"), set: () => {}, hide: () => {} };
        }
        const node = el(`div.toast.is-${kind}`, {}, el("span.toast-icon"), el("span.toast-msg"));
        const iconSlot = node.querySelector(".toast-icon") as HTMLElement;
        const msgSlot = node.querySelector(".toast-msg") as HTMLElement;

        let timer: ReturnType<typeof setTimeout> | undefined;
        const hide = (): void => {
            if (timer) clearTimeout(timer);
            timer = undefined;
            node.classList.add("is-leaving");
            window.setTimeout(() => {
                node.remove();
                if (loadToast === handle) loadToast = null;
            }, 220);
        };

        const handle: ToastHandle = {
            node,
            set: (nextKind, nextMessage, nextTtl) => {
                node.className = `toast is-${nextKind}`;
                iconSlot.replaceChildren(icon(KIND_ICON[nextKind]));
                msgSlot.textContent = nextMessage;
                if (timer) clearTimeout(timer);
                timer = nextTtl > 0 ? setTimeout(hide, nextTtl) : undefined;
            },
            hide
        };

        mount(root, node);
        while (root.children.length > MAX_VISIBLE) {
            const oldest = root.firstElementChild;
            if (oldest) oldest.classList.add("is-leaving");
            window.setTimeout(() => oldest?.remove(), 220);
        }
        handle.set(kind, message, ttl);
        return handle;
    }

    return {
        root,
        info: (message) => makeToast("info", message, DURATION.info),
        warn: (message) => makeToast("warning", message, DURATION.warning),
        error: (message) => makeToast("error", message, DURATION.error),
        success: (message) => makeToast("success", message, DURATION.success),
        boot: () => {
            if (loadToast) {
                loadToast.set("info", "Starting AJAN Engine…", LOAD_TTL);
            } else {
                loadToast = makeToast("info", "Starting AJAN Engine…", LOAD_TTL, false);
            }
        },
        progress: (pct) => {
            if (!loadToast) loadToast = makeToast("info", "Loading model…", LOAD_TTL, false);
            loadToast.set("info", `Loading model… ${Math.max(0, Math.min(100, pct))}%`, LOAD_TTL);
        },
        ready: (message) => {
            if (loadToast) {
                loadToast.set("success", message, DURATION.success);
            } else {
                makeToast("success", message, DURATION.success, false);
            }
        }
    };
}