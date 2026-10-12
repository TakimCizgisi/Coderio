/**
 * Küçük DOM yardımcıları.
 *
 * Arayüz elle `innerHTML` kullanmaz; her bileşen bu yardımcıyla öğe üretir.
 * Böylece kullanıcıdan gelen metin (token, araç çıktısı) hiçbir zaman HTML
 * olarak yorumlanmaz.
 */

export type Child = Node | string | null | undefined | false;

/**
 * `tag.class1.class2` kısaltmasıyla öğe üretir.
 *
 * Sınıfsız ve bilinen bir etiket verildiğinde o etikete özgü tip döner
 * (`el("button")` -> `HTMLButtonElement`), böylece `.disabled` gibi
 * özellikler tip denetiminde yakalanır. Sınıf eki varsa genel `HTMLElement`
 * döner.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
    spec: K,
    attrs?: Record<string, string>,
    ...children: Child[]
): HTMLElementTagNameMap[K];
export function el(spec: string, attrs?: Record<string, string>, ...children: Child[]): HTMLElement;
export function el(spec: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
    const [tag, ...classes] = spec.split(".");
    const node = document.createElement(tag || "div");
    if (classes.length > 0) node.className = classes.join(" ");
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null) continue;
        // `text` öznitelik değildir: içeriğe atanır ve HTML olarak yorumlanmaz.
        if (key === "text") node.textContent = value;
        else node.setAttribute(key, value);
    }
    append(node, children);
    return node;
}

export function append(parent: Node, children: Child[]): void {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
}

/** Bir öğeyi başka bir öğenin içine ekler (yoksa sessizce geçer). */
export function mount(parent: Element | null | undefined, ...children: Child[]): void {
    if (!parent) return;
    append(parent, children);
}

/** Bir öğenin alt çocuklarını temizler. */
export function clear(node: Element): void {
    node.replaceChildren();
}
