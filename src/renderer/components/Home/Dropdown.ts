/**
 * Açılır menü.
 *
 * Prototipteki davranış: düğmeye tıklamak menüyü açar, başka bir açılır menü
 * açılırsa bu kapanır, dışarı tıklamak veya `Esc` kapatır.
 *
 * `document` dinleyicileri her menü için ayrı ayrı eklenmez; modül düzeyinde tek
 * bir "şu an açık olan menü" kaydı tutulur.
 */
import { el, mount } from "../../core/dom.js";

export type DropdownItem = {
    key: string;
    label: string;
    disabled?: boolean;
    onSelect?: () => void;
};

export type DropdownProps = {
    /** Menüyü açan düğme (`.menu-button` veya `.project-trigger-btn` sınıflı). */
    trigger: HTMLElement;
    items: DropdownItem[];
    /**
     * Menü görünümü; genişlik CSS'ten gelir.
     *
     * Genişlik `style` özniteliğiyle verilemez: CSP `style-src 'self'` satır içi
     * stilleri bloklar. Bu yüzden sınıf seçicileri kullanılır.
     */
    variant?: "menu" | "project";
};

/** Şu an açık olan menünün kapanma işlevi. */
let activeCloser: (() => void) | null = null;

/** Dışarı tıklama ve `Esc` tek bir dinleyiciyle yönetilir. */
document.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null;
    if (!activeCloser) return;
    // Menünün kendi içine tıklamak kapatmaz; öğeler seçilince kapanır.
    if (target?.closest(".dd-wrapper")) return;
    activeCloser();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") activeCloser?.();
});

export function Dropdown({ trigger, items, variant = "menu" }: DropdownProps): HTMLElement {
    const list = el("div.dropdown-menu");
    for (const item of items) mount(list, itemView(item, close));

    const root = el(`div.dd-wrapper.dd-${variant}`, {}, trigger, list);

    let open = false;

    /** Bu menüyü kapatır. Zaten kapalıysa hiçbir şeye dokunmaz. */
    function close(): void {
        if (!open) return;
        open = false;
        root.classList.remove("is-open");
        // Yalnızca bu menü kayıtlıysa kaydı temizle; başka menünün kaydı
        // yanlışlıkla silinmemeli.
        if (activeCloser === close) activeCloser = null;
    }

    function setOpen(next: boolean): void {
        if (next === open) return;
        if (next) {
            // Aynı anda yalnızca bir menü açık olabilir.
            activeCloser?.();
            open = true;
            root.classList.add("is-open");
            activeCloser = close;
            // Chat düzeninde .home üst üste (overflow) oluşuyla menü kırpılıyordu;
            // açılışta alt alan yetmiyorsa yukarı açılır (is-above).
            requestAnimationFrame(() => {
                const menuRect = list.getBoundingClientRect();
                const wrapRect = root.getBoundingClientRect();
                const spaceBelow = window.innerHeight - wrapRect.bottom;
                root.classList.toggle("is-above", menuRect.height > spaceBelow);
            });
        } else {
            close();
        }
    }

    trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        setOpen(!open);
    });

    return root;
}

function itemView(item: DropdownItem, onSelect: () => void): HTMLElement {
    const button = el("button", { type: "button", class: "dropdown-item", "data-key": item.key, text: item.label });
    button.disabled = item.disabled === true;
    if (!button.disabled) {
        button.addEventListener("click", () => {
            onSelect();
            item.onSelect?.();
        });
    }
    return button;
}