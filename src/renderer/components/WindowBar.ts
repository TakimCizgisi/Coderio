/**
 * Özel başlık çubuğu (çerçevesiz pencere).
 *
 * Pencere `frame: false` ile açıldığı için minimize/maksimum/kapat düğmeleri
 * renderer tarafında çizilir. Eylemler `window.coderio.app.window` üzerinden
 * ana sürece gider; renderer `BrowserWindow`'ı doğrudan görmez.
 *
 * Sürükleme bölgesi `-webkit-app-region: drag` ile CSS'te tanımlıdır; düğmeler
 * `no-drag` olmalıdır, aksi hâlde tıklamalar sürüklemeye dönüşür.
 */
import { el } from "../core/dom.js";

export type WindowBarProps = {
    title: string;
};

export type WindowBar = HTMLElement & {
    /** Maksimum durum değişince çağrılır. */
    setMaximized: (maximized: boolean) => void;
    /** Başlıktaki metni değiştirir (oturum adı). */
    setTitle: (title: string) => void;
};

export function WindowBar({ title }: WindowBarProps): WindowBar {
    const restore = el("span.winbar-glyph", {}, svgRestore());
    const maximize = el("span.winbar-glyph", {}, svgMaximize());
    // `winbar-max` sınıfı CSS'te ikon değişimini yalnızca bu düğmeyle sınırlar;
    // aksi hâlde minimize düğmesinin `nth-child(1)` ikonu da eşleşir.
    const maximizeButton = el(
        "button",
        { type: "button", class: "winbar-button winbar-max", "aria-label": "Resize" },
        maximize,
        restore
    );

    const minimizeButton = el(
        "button",
        { type: "button", class: "winbar-button", "aria-label": "Minimize" },
        el("span.winbar-glyph", {}, svgMinimize())
    );
    const closeButton = el(
        "button",
        { type: "button", class: "winbar-button winbar-close", "aria-label": "Close" },
        el("span.winbar-glyph", {}, svgClose())
    );

    const api = window.coderio?.app?.window;
    minimizeButton.addEventListener("click", () => void api?.minimize());
    maximizeButton.addEventListener("click", () => void api?.toggleMaximize());
    closeButton.addEventListener("click", () => void api?.close());

    const titleEl = el("span.winbar-title", { text: title });
    const bar = el(
        "header.winbar",
        {},
        titleEl,
        el("div.winbar-controls", {}, minimizeButton, maximizeButton, closeButton)
    );

    // Yerleşik davranışı korur: düğmelere tıklamak değil, boşluğa çift tıklamak
    // pencereyi büyütür/küçültür.
    bar.addEventListener("dblclick", (event) => {
        if ((event.target as HTMLElement).closest(".winbar-button")) return;
        void api?.toggleMaximize();
    });

    const setMaximized = (maximized: boolean): void => {
        bar.classList.toggle("is-maximized", maximized);
    };

    const setTitle = (next: string): void => {
        titleEl.textContent = next;
    };

    api?.onStateChange(setMaximized);
    void api?.isMaximized().then(setMaximized).catch(() => undefined);

    return Object.assign(bar, { setMaximized, setTitle });
}

/* Pencere düğmeleri ikon fontu değil, satır içi SVG ile çizilir: Windows'un
   alışılmış görünümü birebir korunur ve ek bir font yükü gelmez. */

function svgMinimize(): SVGSVGElement {
    return svg("M 1 5.5 H 9", "winbar-stroke");
}

function svgMaximize(): SVGSVGElement {
    return svg("M 1.5 1.5 H 8.5 V 8.5 H 1.5 Z", "winbar-stroke");
}

function svgRestore(): SVGSVGElement {
    return svg("M 1.5 3.5 V 8.5 H 6.5 M 3.5 1.5 H 8.5 V 6.5 H 6.5", "winbar-stroke");
}

function svgClose(): SVGSVGElement {
    return svg("M 1.5 1.5 L 8.5 8.5 M 8.5 1.5 L 1.5 8.5", "winbar-stroke");
}

/** SVG alan adı `createElementNS` gerektirir; `el()` yalnızca HTML üretir. */
function svg(pathData: string, className: string): SVGSVGElement {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("viewBox", "0 0 10 10");
    node.setAttribute("class", className);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    node.appendChild(path);
    return node;
}