/**
 * Açılış ekranının logosu.
 *
 * Görsel varlık `UI/LOGO.svg` olarak tek kaynaktan gelir ve `dist/renderer`
 * altına kopyalanır; renderer göreli yoldan yükler. `img-src 'self'` CSP
 * kuralına uyar, dış adres kullanılmaz.
 */
import { el } from "../../core/dom.js";

export function Logo(): HTMLElement {
    return el(
        "div.logo-container",
        {},
        el("img", { src: "LOGO.svg", alt: "Coderio", class: "logo-image" })
    );
}