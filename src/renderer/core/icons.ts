/**
 * Material Symbols ikon yardımcısı.
 *
 * İkonlar ligatur metinleridir (`menu`, `attach_file`, ...); `app.css` içindeki
 * `@font-face` onları glif olarak çevirir. Font `UI/` klasöründen
 * `dist/renderer` altına kopyalanır, dolayısıyla uygulama çevrimdışıdır ve
 * Content-Security-Policy `font-src 'self'` ile engellenmez.
 */
import { el } from "./dom.js";

/** Kullanılan ikon adları — hepsi fontta mevcuttur. */
export const ICONS = {
    menu: "menu",
    expandMore: "expand_more",
    attachFile: "attach_file",
    image: "image",
    pdf: "picture_as_pdf",
    archive: "folder_zip",
    code: "code",
    document: "description",
    settings: "settings",
    close: "close",
    stop: "stop",
    info: "info",
    warning: "warning",
    error: "error",
    success: "check_circle",
    spark: "auto_awesome"
} as const;

export type IconName = (typeof ICONS)[keyof typeof ICONS];

/** Ligatur metnini ikon öğesine çevirir. */
export function icon(name: string): HTMLElement {
    return el("span", { class: "material-symbols-outlined", text: name });
}