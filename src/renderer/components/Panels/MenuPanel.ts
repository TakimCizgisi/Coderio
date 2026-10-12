/**
 * Menü paneli (hamburger düğmesinin karşılığı).
 *
 * Açılır menü chat düzeninde `overflow: hidden` nedeniyle kırpılıyordu; bunun
 * yerine ayarlar penceresiyle aynı desende, ortalanmış bir panel açılır ve
 * kullanıcı yapmak istediği işlemi oradan seçer. Her açılışta öğe listesi
 * taze üretilir (durum/seçimler güncel olsun diye).
 */
import { el, mount, clear } from "../../core/dom.js";
import { icon, ICONS } from "../../core/icons.js";
import type { DropdownItem } from "../Home/Dropdown.js";

export type MenuPanel = {
    open: () => void;
    close: () => void;
    root: HTMLElement;
};

export function MenuPanel(getItems: () => DropdownItem[]): MenuPanel {
    const root = el("div.menu-overlay", {}, el("div.settings-scrim"));
    const list = el("div.settings-list.menu-list");
    const closeButton = el("button", { type: "button", class: "settings-close", "aria-label": "Close menu" }, icon(ICONS.close));
    const panel = el(
        "section.menu-panel",
        {},
        el("header.settings-header", {}, el("span.settings-title", { text: "Menu" }), closeButton),
        list
    );
    mount(root, panel);
    // Uygulama açılışında görünmemelidir; yalnızca `open()` ile gösterilir.
    root.hidden = true;

    function render(): void {
        clear(list);
        for (const item of getItems()) {
            const button = el("button", { type: "button", class: "menu-item", "data-key": item.key, text: item.label });
            button.disabled = item.disabled === true;
            if (!button.disabled) {
                button.addEventListener("click", () => {
                    close();
                    item.onSelect?.();
                });
            }
            mount(list, button);
        }
    }

    function open(): void {
        render();
        root.hidden = false;
    }
    function close(): void {
        root.hidden = true;
    }

    closeButton.addEventListener("click", close);
    root.querySelector(".settings-scrim")?.addEventListener("pointerdown", close);
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
    });

    return { open, close, root };
}