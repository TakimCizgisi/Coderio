/**
 * Ana ekran.
 *
 * Düzen durumları:
 *  - `idle`: dikey ortalanmış logo + prompt kutusu (açılış ekranı);
 *  - `chat`: ilk mesaj atılınca logo gizlenir, prompt kutusu alta sabitlenir,
 *    araya sohbet görünümü girer. "Yeni sohbet" yine açılış ekranına döner.
 *
 * Motor bildirimleri (yükleme, hata, uyarı, başarı) sohbet kaydını kirletmez;
 * sağ alt köşede prompt kutusu görünümünde küçük `Notify` kutularına ikon + renk
 * + mesaj olarak yazılır ve birkaç saniye sonra kendiliğinden gizlenir.
 * "always" modunda model ısınırken gönderim düğmesi soluk (kilitli) kalır.
 */
import { el, mount } from "../../core/dom.js";
import { WindowBar, type WindowBar as WindowBarView } from "../WindowBar.js";
import { Logo } from "./Logo.js";
import { PromptBox, type PromptBox as PromptBoxView } from "./PromptBox.js";
import { ChatLog, type ChatLogView } from "../ChatLog/ChatLog.js";
import { Notify, type NotifyView } from "../Notifications/Notify.js";
import type { DropdownItem } from "./Dropdown.js";
import type { EventFrame, StatusReport, StoredMessage } from "../../../protocol/api.js";

export type HomeProps = {
    /** Başlık çubuğunda gösterilen ad. */
    title: string;
    /** Açık proje adı; yoksa "Proje yok". */
    project: string;
    status: StatusReport | null;
    projectItems: DropdownItem[];
    /** Menü düğmesine basılınca (panel açılır). */
    onOpenMenu: () => void;
    onSend: (text: string) => void;
    onStop: () => void;
};

export type HomeView = HTMLElement & {
    windowBar: WindowBarView;
    prompt: PromptBoxView;
    notify: NotifyView;
    /** Motor olayını sohbete ekler. */
    pushEvent: (event: EventFrame) => void;
    /** Kullanıcı mesajını sohbete ekler ve sohbet düzenine geçirir. */
    pushUser: (text: string) => void;
    /** Sohbeti temizler; tekrar açılış ekranına döner. */
    clearOutput: () => void;
    /** Kayıtlı oturumu sohbette canlandırır (geçmişten yükleme). */
    restoreSession: (messages: StoredMessage[]) => void;
    /** Başlık çubuğunun ortasına oturum adını yazar (ör. akıllı başlık). */
    setSessionTitle: (title: string) => void;
    /** Durum değiştiğinde düğmeleri günceller. */
    applyStatus: (status: StatusReport | null) => void;
};

export function Home(props: HomeProps): HomeView {
    const prompt = PromptBox({
        project: props.project,
        projectItems: props.projectItems,
        onOpenMenu: props.onOpenMenu,
        onSend: props.onSend,
        onStop: props.onStop
    });

    const chat = ChatLog();
    const notify = Notify();
    const indicator = el(
        "div.chat-header",
        {},
        el("span.chat-model"),
        el("span.chat-context")
    );
    const chatArea = el("div.chat-area", {}, indicator, chat.root);

    // Prototipteki sarmalayıcı: logo ile prompt kutusu 700px sütunda durur.
    const container = el("div.ai-prompt-container", {}, Logo(), prompt);
    const main = el("main.home", {}, chatArea, container, notify.root);
    const windowBar = WindowBar({ title: props.title });
    const screen = el("div.screen", {}, windowBar, main);

    let lastStatus: StatusReport | null = null;
    let booted = false;

    /** İlk kullanıcı mesajında sohbet düzenine geç. */
    function enterChat(): void {
        screen.classList.add("is-chat");
    }

    /** Açılış ekranına dön. */
    function exitChat(): void {
        screen.classList.remove("is-chat");
    }

    const applyStatus = (status: StatusReport | null): void => {
        lastStatus = status;
        prompt.setBusy(status?.busy === true);
        // Model ısınırken gönderimi kilitle (yalnızca "always" modunda: model
        // ilk mesajda yüklenecekse loading zaten idle'dır ve kilit uygulanmaz).
        prompt.setCanSend(sendGateEnabled(status));
        setIndicator(status);

        if (!status) return;

        // Açılış bildirimi yalnızca bir kez: yalnızca "always" modunda anlamlıdır.
        if (!booted) {
            booted = true;
            if (!status.installed) {
                notify.warn("Model not installed — open Settings to install it.");
            } else if (status.config.autostartModel !== false) {
                // Motor açılışta arka planda ısınıyorsa "Starting…" toast'ı; zaten
                // hazırsa (hızlı makine, olay kaçmış) doğrudan başarı göster.
                if (status.loading) notify.boot();
                else notify.ready("AJAN Engine Started.");
            }
            // Autostart kapalı: sessiz; model ilk mesajda yüklenir.
        }
    };
    applyStatus(props.status);

    /** Üstteki ince çubuk: aktif model + bağlam doluluk oranı. */
    function setIndicator(status: StatusReport | null): void {
        const model = indicator.querySelector(".chat-model");
        const context = indicator.querySelector(".chat-context");
        model && (model.textContent = status?.modelName ?? "…");
        if (status?.context && status.context.contextSize > 0) {
            const pct = Math.round((status.context.usedTokens / status.context.contextSize) * 100);
            context && (context.textContent = `Context ${pct}%`);
        } else {
            context && (context.textContent = "");
        }
    }

    return Object.assign(screen, {
        windowBar,
        prompt,
        notify,
        pushEvent: (event: EventFrame): void => {
            switch (event.event) {
                case "session-title":
                    windowBar.setTitle(event.title);
                    return;
                case "load-progress":
                    notify.progress(event.pct);
                    return;
                case "load-complete":
                    notify.ready("AJAN Engine Started.");
                    // Model ayağa kalktı: killidi kaldır, 5 sn'lik durum
                    // yoklamasını bekleme.
                    prompt.setCanSend(sendGateEnabled(lastStatus));
                    return;
                case "log":
                    if (event.level === "warn") notify.warn(event.message);
                    else if (event.level === "error") {
                        notify.error(event.message);
                        chat.pushEvent(event);
                    }
                    return;
                case "error":
                    notify.error(event.message);
                    chat.pushEvent(event);
                    return;
                default:
                    chat.pushEvent(event);
            }
        },
        pushUser: (text: string): void => {
            enterChat();
            chat.pushUser(text);
        },
        clearOutput: (): void => {
            exitChat();
            chat.clear();
            prompt.reset();
            // Yeni sohbet modeli asla kapatmaz; kullanıcıya hazır olduğunu göster.
            if (lastStatus?.installed === true) notify.success("Model ready — kept loaded in background.");
        },
        restoreSession: (messages: StoredMessage[]): void => {
            exitChat();
            chat.clear();
            prompt.reset();
            chat.restore(messages);
            enterChat();
        },
        setSessionTitle: (title: string): void => windowBar.setTitle(title),
        applyStatus
    });
}

/** Durumdan proje düğmesi etiketini üretir. */
export function projectLabel(status: StatusReport | null): string {
    const cwd = status?.cwd;
    if (!cwd) return "No project";
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? "No project";
}

/**
 * Model ısınırken gönderim kilidi "always" modunda açıktır: model kurulu ve ayrıca
 * arka planda yükleniyorsa, hazır olana kadar gönderim kapalıdır. Autostart
 * kapalıysa (model ilk mesajda yüklenecek) kilit hiç uygulanmaz.
 */
function sendGateEnabled(status: StatusReport | null): boolean {
    return !(status?.installed === true && status.config.autostartModel !== false && status.loading === true);
}

/**
 * Açılış yükleme ekranı kaldırıldı: açılış doğrudan `idle` düzenidir (logo +
 * prompt). Motor ilerlemesi sağ alttaki `Notify` toast'larına akar.
 */

/** `Home` dışına yeni bölüm eklemek için yardımcı. */
export function appendSection(home: HTMLElement, section: HTMLElement): void {
    mount(home, section);
}