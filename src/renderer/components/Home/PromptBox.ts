/**
 * Prompt kutusu: metin alanı + alt araç çubuğu.
 *
 * Prototipteki davranışlar birebir korunur:
 *  - metin alanı içeriğiyle birlikte 24px ile 150px arasında büyürü/küçülür,
 *    sınıra dayanınca kendi kaydırma çubuğu görünür;
 *  - solda menü (hamburger) ve proje seçici; sağda beyaz gönder düğmesi;
 *  - yazılan metin yerel taslağa yazılır ve uygulama yeniden açılınca geri gelir.
 *
 * Erişilebilirlik: `Enter` gönderir, `Shift+Enter` satır atlar.
 */
import { el, mount } from "../../core/dom.js";
import { icon, ICONS } from "../../core/icons.js";
import { Dropdown, type DropdownItem } from "./Dropdown.js";

/** Metin alanının en düşük ve en yüksek yüksekliği (piksel). */
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 150;

/** Yazı taslağının saklandığı localStorage anahtarı. */
const DRAFT_KEY = "coderio.draft.v1";

export type PromptBoxProps = {
    /** Proje düğmesinde görünen ad. */
    project: string;
    /** Proje seçici açılır listesi. */
    projectItems: DropdownItem[];
    /** Menü düğmesine basılınca çağrılır (Settings benzeri paneli açar). */
    onOpenMenu: () => void;
    /** Metin gönderildiğinde çağrılır. */
    onSend: (text: string) => void;
    /** Motor meşgulken çağrılır; üretimi durdurur. */
    onStop: () => void;
    /** Motor meşgulken gönderim yapılabilir mi? */
    busy?: boolean;
};

export type PromptBox = HTMLElement & {
    /** Proje düğmesinin etiketini günceller. */
    setProject: (name: string) => void;
    /** Gönder düğmesini etkinleştirir/etkisizleştirir. */
    setBusy: (busy: boolean) => void;
    /** Model hazır değilken gönderimi kilitleyip düğmeyi soluklaştırır. */
    setCanSend: (canSend: boolean) => void;
    /** Metin alanına odaklanır. */
    focus: () => void;
    /** Kullanıcının yazdığı metni döner (gönderim sonrası temizlenir). */
    value: () => string;
    /** Metin alanını ve taslağı boşaltır. */
    reset: () => void;
};

export function PromptBox(props: PromptBoxProps): PromptBox {
    const textarea = el("textarea", {
        class: "prompt-input",
        placeholder: "Ask anything...",
        rows: "1"
    });
    textarea.addEventListener("input", () => {
        resize(textarea);
        scheduleDraftSave(textarea);
    });
    // Enter gönderir; Shift+Enter satır atlar.
    textarea.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        send();
    });

    // ── Sol: menü ──
    const menuButton = el("button", {
        type: "button",
        class: "menu-button",
        "aria-haspopup": "menu",
        "aria-label": "Menu",
        title: "Menu"
    });
    mount(menuButton, icon(ICONS.menu));
    menuButton.addEventListener("click", () => props.onOpenMenu());

    // ── Sol: proje seçici ──
    const projectLabel = el("span.project-label", { text: props.project });
    const projectButton = el(
        "button",
        { type: "button", class: "project-trigger-btn", "aria-haspopup": "menu" },
        projectLabel,
        icon(ICONS.expandMore)
    );
    const projectMenu = Dropdown({ trigger: projectButton, items: props.projectItems, variant: "project" });

    const toolbarLeft = el("div.toolbar-left", {}, menuButton, projectMenu);

    // ── Sağ: gönder / durdur ──
    const arrowIcon = sendArrow();
    const stopIcon = icon(ICONS.stop);
    const sendButton = el("button", {
        type: "button",
        class: "prompt-button",
        "aria-label": "Send",
        title: "Send (Enter)"
    });
    sendButton.appendChild(arrowIcon);
    sendButton.addEventListener("click", () => {
        if (busy) props.onStop();
        else if (canSend) send();
    });

    const toolbar = el("div.prompt-toolbar", {}, toolbarLeft, sendButton);
    const box = el("div.prompt-box", {}, textarea, toolbar);

    let busy = false;
    let canSend = true;

    function send(): void {
        if (busy || !canSend) return;
        const text = textarea.value.trim();
        if (!text) return;
        props.onSend(text);
        textarea.value = "";
        clearDraft();
        resize(textarea);
    }

    function setBusy(value: boolean): void {
        busy = value;
        sendButton.classList.toggle("is-busy", value);
        // Busy bitince kilit hâlâ geçerliyse soluk kalsın (is-canSend kuralı).
        sendButton.classList.toggle("is-disabled", !value && !canSend);
        sendButton.replaceChildren(value ? stopIcon : arrowIcon);
        sendButton.setAttribute("aria-label", value ? "Stop" : "Send");
        sendButton.title = value ? "Stop generating" : canSend ? "Send (Enter)" : "Loading model…";
    }

    function setCanSend(value: boolean): void {
        canSend = value;
        sendButton.classList.toggle("is-disabled", !value && !busy);
        sendButton.title = value ? "Send (Enter)" : "Loading model…";
    }
    setBusy(false);
    setCanSend(true);

    /*** ── Yazı taslağı (kalıcı metin) ── */
    let draftTimer: number | undefined;

    function scheduleDraftSave(input: HTMLTextAreaElement): void {
        if (draftTimer) clearTimeout(draftTimer);
        draftTimer = window.setTimeout(() => saveDraft(input.value), 300);
    }

    function clearDraft(): void {
        if (draftTimer) clearTimeout(draftTimer);
        try {
            localStorage.removeItem(DRAFT_KEY);
        } catch {
            /* erişim yoksa yok say */
        }
    }

    // Açılışta kayıtlı taslağı geri getir.
    try {
        const saved = localStorage.getItem(DRAFT_KEY);
        if (saved) {
            textarea.value = saved;
            resize(textarea);
        }
    } catch {
        /* yok say */
    }

    return Object.assign(box, {
        setProject: (name: string) => {
            projectLabel.textContent = name;
        },
        setBusy,
        setCanSend,
        focus: () => textarea.focus(),
        value: () => textarea.value,
        reset: () => {
            textarea.value = "";
            clearDraft();
            resize(textarea);
        }
    });
}

/**
 * Metin alanını içeriğe göre büyütür/küçültür.
 *
 * Önce yükseklik sıfırlanır; aksi hâlde yalnızca büyüyebilirdi. `scrollHeight`
 * içeriğin gerçek yüksekliğini verir.
 */
function resize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "auto";
    const wanted = Math.min(Math.max(textarea.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    textarea.style.height = `${wanted}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
}

/** Taslağı localStorage'a yazar (boşsa siler). */
function saveDraft(value: string): void {
    try {
        if (value.trim()) localStorage.setItem(DRAFT_KEY, value);
        else localStorage.removeItem(DRAFT_KEY);
    } catch {
        /* yok say */
    }
}

/** Prototipteki beyaz gönder düğmesinin oku. */
function sendArrow(): SVGSVGElement {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("viewBox", "0 0 16 16");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
        "d",
        "M8 15a.5.5 0 00.5-.5V2.707l3.146 3.147a.5.5 0 00.708-.708l-4-4a.5.5 0 00-.708 0l-4 4a.5.5 0 10.708.708L7.5 2.707V14.5a.5.5 0 00.5.5z"
    );
    node.appendChild(path);
    return node;
}