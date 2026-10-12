/**
 * Sohbet görünümü.
 *
 * Kullanıcı mesajları solda, asistan yanıtı sağda olacak şekilde "tur"
 * temelinde çalışır. Token olayları tek bir baloncuğa akar; `thinking-chunk`
 * katlanabilir bir düşünme bölümünde, `tool-call`/`tool-result` "Using Tool(s)"
 * çipleri olarak gösterilir. `load-progress` gibi model olayları buraya gelmez
 * (Home bunları durum çubuğuna yönlendirir).
 */
import { el, mount, clear } from "../../core/dom.js";
import type { EventFrame, StoredMessage } from "../../../protocol/api.js";

/** Belleği sınırda tutmak için görünürde tutulan maksimum mesaj (kullanıcı+asistan) çifti. */
const MAX_TURNS = 120;

export type ChatLogView = {
    root: HTMLElement;
    pushUser: (text: string) => void;
    pushEvent: (event: EventFrame) => void;
    /** Kayıtlı sohbeti canlandırır (akış olmadan). */
    restore: (messages: StoredMessage[]) => void;
    clear: () => void;
};

type Turn = {
    root: HTMLElement;
    /** Yanıt baloncuğu (ilk token geldiğinde üretilir). */
    bubble: HTMLElement | null;
    /** Düşünme metninin yazıldığı düğüm. */
    thinking: HTMLElement | null;
    thinkingWrap: HTMLElement | null;
    /** Düşünme başlığının ikonu (spinner ↔ ✓ değişir). */
    thinkingIcon: HTMLElement | null;
    /** Düşünme başlığı metni ("Thinking…" ↔ "Thought for Ns"). */
    thinkingLabel: HTMLElement | null;
    /** Düşünme bitti mi? (ilk düşünme-dışı içerik geldiğinde). */
    thinkingDone: boolean;
    /** Düşünmenin başladığı an (süre "Thought for Ns" için). */
    thinkingStart: number;
    /** Araç çipleri kabı. */
    tools: HTMLElement | null;
    /** Bu turdaki araç çağrısı sayısı (adım pill'ini ne zaman göster). */
    toolCount: number;
    /** Alt durum satırı ("Step 1/25" ...). */
    status: HTMLElement | null;
    /** En son görünen adım. */
    stepLast: number;
    stepMax: number;
    /** Yazan göstergesi. */
    typing: HTMLElement | null;
};

export function ChatLog(): ChatLogView {
    const root = el("div.chat-log");

    let turn: Turn | null = null;
    /** Aynı asistan turu hâlâ akıyor mu? */
    let active = false;

    function scroll(): void {
        root.scrollTop = root.scrollHeight;
    }

function pushUser(text: string): void {
    root.append(userMessage(text));
    beginTurn();
    scroll();
}

function beginTurn(): Turn {
    turn = assistantTurn();
    root.append(turn.root);
    active = true;
    scroll();
    return turn;
}

function endTurn(t?: Turn | null): void {
    active = false;
    if (t?.typing) t.typing.hidden = true;
    turn = null;
}

    function pushEvent(event: EventFrame): void {
        if (!turn) beginTurn();
        const t = turn as Turn;

        switch (event.event) {
            case "text-chunk": {
                if (!event.text) break;
                // Yanıt başladı: düşünme bitti, çipe dönüşür.
                thinkFinished(t);
                answerBubble(t).append(document.createTextNode(event.text));
                if (t.typing) t.typing.hidden = true;
                break;
            }

            case "thinking-chunk": {
                if (!event.text) break;
                // Çok turlu ajan akışında düşünme yeniden başlayabilir.
                if (t.thinkingDone) markThinkingRunning(t);
                if (!t.thinkingStart) t.thinkingStart = performance.now();
                thinkingRegion(t).append(document.createTextNode(event.text));
                if (t.typing) t.typing.hidden = true;
                break;
            }

            case "tool-call":
                thinkFinished(t);
                if (!t.toolCount) setStepPill(t);
                t.toolCount++;
                addToolChip(t, event);
                break;

            case "tool-result": {
                const chip = toolsContainer(t).querySelector(`[data-tool="${cssEscape(event.name)}"]`);
                if (chip) finishToolChip(chip, event);
                break;
            }

            case "step-start":
                t.stepLast = event.step;
                t.stepMax = event.maxSteps;
                // Pill'i yalnızca araç kullanılmışsa göster: basit yanıtlar
                // durum satırıyla kalabalıklaşmasın.
                if (t.toolCount > 0) setStatus(t, `Step ${event.step}/${event.maxSteps}`);
                break;

            case "step-end":
                break;

            case "complete":
                // Akış bitti: düşünme açıksa çipe dönüştür, düz metni markdown
                // olarak yeniden çiz (tam metin elimizde artık).
                thinkFinished(t);
                if (t.bubble) {
                    const text = t.bubble.textContent ?? "";
                    clear(t.bubble);
                    renderMarkdown(t.bubble, text);
                }
                if (t.toolCount > 0 || t.stepMax > 1) setStatus(t, "completed");
                else if (t.status) t.status.hidden = true;
                endTurn();
                break;

            case "error":
                attachTo(t, errorNote(event.message));
                endTurn();
                break;

            case "log":
                if (event.level === "error") {
                    attachTo(t, errorNote(event.message));
                    endTurn();
                }
                break;

            default:
                break;
        }
        scroll();

        // Bellek sınırı: fazla mesaj çiftlerini tepeden düşürür.
        while (root.children.length > MAX_TURNS * 2) root.firstChild?.remove();
    }

function clearView(): void {
        clear(root);
        turn = null;
        active = false;
    }

    /** Kayıtlı oturumu sohbete çizer (akış olmadan). */
    function restore(messages: StoredMessage[]): void {
        clearView();
        for (const message of messages) {
            if (message.kind === "user") {
                // Yalnızca kullanıcı baloncuğu; asistan turu bir sonraki
                // (assistant/thought/tool) mesajıyla başlar.
                root.append(userMessage(message.text ?? ""));
                continue;
            }
            const t = beginTurn();
            switch (message.kind) {
                case "assistant": {
                    if (message.text) renderMarkdown(answerBubble(t), message.text);
                    if (t.status) t.status.textContent = "completed";
                    endTurn(t);
                    break;
                }
                case "thought": {
                    if (message.text) {
                        const textNode = thinkingRegion(t);
                        textNode.append(document.createTextNode(message.text));
                    }
                    // Restore'da "Thinking…" yanıltmasın: doğrudan bitmiş çipe dön.
                    thinkFinished(t);
                    endTurn(t);
                    break;
                }
                case "tool": {
                    const chip = el(
                        "div.tool-chip",
                        { "data-tool": message.name ?? "tool", "data-state": message.state === "error" ? "fail" : "ok" },
                        chipIcon(message.state === "error" ? "fail" : "ok"),
                        el("span.tool-chip-name", { text: message.name ?? "tool" })
                    );
                    if (message.output) mount(chip, el("div.tool-result", { text: message.output }));
                    toolsContainer(t).append(chip);
                    endTurn(t);
                    break;
                }
                default:
                    endTurn(t);
            }
            // Bellek sınırı: restore büyük oturumlarda da geçerli olsun.
            while (root.children.length > MAX_TURNS * 2) root.firstChild?.remove();
        }
        scroll();
    }

    return { root, pushUser, pushEvent, restore, clear: clearView };
}

/* ── Oluşturucular ── */

function userMessage(text: string): HTMLElement {
    return el(
        "div.msg.msg-user",
        {},
        el("div.bubble.bubble-user", { text })
    );
}

function assistantTurn(): Turn {
    const row = el(
        "div.msg-row",
        {},
        el(
            "div.bubble-col",
            {},
            el("div.msg-attach"),
            el("div.msg-typing", {}, el("span.dot"), el("span.dot"), el("span.dot")),
            el("div.msg-status", { hidden: "" })
        )
    );
    const rootEl = el("div.msg.msg-ai", {}, row);
    const typing = rootEl.querySelector<HTMLElement>(".msg-typing");
    const status = rootEl.querySelector<HTMLElement>(".msg-status");

    return {
        root: rootEl,
        bubble: null,
        thinking: null,
        thinkingWrap: null,
        thinkingIcon: null,
        thinkingLabel: null,
        thinkingDone: false,
        thinkingStart: 0,
        tools: null,
        toolCount: 0,
        typing,
        status,
        stepLast: 0,
        stepMax: 0
    };
}

function attachTo(t: Turn, node: ChildNode): void {
    const attach = t.root.querySelector(".msg-attach");
    attach?.append(node);
}

/** Yanıt baloncuğunu ilk token geldiğinde üretir (boş tur görünmesin diye). */
function answerBubble(t: Turn): HTMLElement {
    if (!t.bubble) {
        t.bubble = el("div.bubble.bubble-ai");
        attachTo(t, t.bubble);
    }
    return t.bubble;
}

function thinkingRegion(t: Turn): HTMLElement {
    if (t.thinking) return t.thinking;

    const icon = thinkingSpinner();
    const label = el("span.thinking-label", { text: "Thinking…" });
    const text = el("div.thinking-text");
    const head = el("button", { type: "button", class: "thinking-head", "aria-expanded": "false" }, icon, label);
    head.addEventListener("click", () => {
        const open = t.thinkingWrap?.classList.toggle("is-open") ?? false;
        head.setAttribute("aria-expanded", String(open));
    });

    const wrap = el("div.thinking-wrap", {}, head, text);
    t.thinkingWrap = wrap;
    t.thinking = text;
    t.thinkingIcon = icon;
    t.thinkingLabel = label;
    attachTo(t, wrap);
    return text;
}

/** Düşünme başlığını "Thinking…" (spinner) durumuna geri döndürür. */
function markThinkingRunning(t: Turn): void {
    t.thinkingDone = false;
    t.thinkingStart = performance.now();
    t.thinkingWrap?.classList.remove("thinking-done");
    if (t.thinkingIcon) {
        clear(t.thinkingIcon);
        t.thinkingIcon.append(thinkingSpinner());
    }
    if (t.thinkingLabel) t.thinkingLabel.textContent = "Thinking…";
}

/**
 * Düşünmeyi bitmiş duruma çevirir: spinner yerine ✓ ve "Thought" (süre varsa
 * "Thought for Ns") etiketi. Düşünme yoksa/yok sayılabilirse sessizce biter.
 */
function thinkFinished(t: Turn): void {
    if (t.thinkingDone || !t.thinkingWrap) return;
    t.thinkingDone = true;
    t.thinkingWrap.classList.add("thinking-done");
    const dur = Math.max(0, Math.round((performance.now() - (t.thinkingStart || performance.now())) / 1000));
    if (t.thinkingIcon) {
        clear(t.thinkingIcon);
        t.thinkingIcon.append(checkIcon());
    }
    if (t.thinkingLabel) t.thinkingLabel.textContent = dur >= 1 ? `Thought for ${dur}s` : "Thought";
}

function setStatus(t: Turn, text: string): void {
    if (!t.status) return;
    t.status.textContent = text;
    t.status.hidden = false;
}

/** Adım pill'ini ilk araç çağrısında gösterir ("Step n/max"). */
function setStepPill(t: Turn): void {
    if (!t.stepLast) return;
    setStatus(t, `Step ${t.stepLast}/${t.stepMax || t.stepLast}`);
}

function toolsContainer(t: Turn): HTMLElement {
    if (!t.tools) {
        t.tools = el("div.tool-chips");
        attachTo(t, t.tools);
    }
    return t.tools;
}

function addToolChip(t: Turn, event: Extract<EventFrame, { event: "tool-call" }>): void {
    const args = summarizeArgs(event.args);
    const chip = el(
        "div.tool-chip",
        { "data-tool": event.name, "data-state": "running", title: `${event.name}(${args})` },
        chipIcon("running"),
        el("span.tool-chip-name", { text: event.name }),
        args ? el("span.tool-chip-args", { text: `(${args})` }) : null
    );
    toolsContainer(t).append(chip);
    chip.addEventListener("click", () => chip.classList.toggle("is-open"));
}

function finishToolChip(chip: Element, event: Extract<EventFrame, { event: "tool-result" }>): void {
    chip.setAttribute("data-state", event.ok ? "ok" : "fail");
    chip.querySelector(".tool-chip-icon")?.replaceWith(chipIcon(event.ok ? "ok" : "fail"));
    // Tekrarlanan sonuçlarda eski önizlemeyi temizle (aynı araç iki kez çağrılabilir).
    chip.querySelector(".tool-result")?.remove();
    const out = firstLine(event.output);
    if (out) mount(chip, el("div.tool-result", { text: out }));
}

function errorNote(message: string): HTMLElement {
    return el("div.msg-error", { text: message });
}

/* ── Sade markdown (memleket render'ı, yeni bağımlılık yok) ── */

/**
 * Düz metni sohbet balonuna uygun bir alt kümeyle çizer: başlıklar,
 * kod blokları (kopyalama düğmeli), listeler ve satır içi `code`/bold/italic.
 * İçerik DOM düğümleri olarak kurulur; `innerHTML` kullanılmaz.
 */
function renderMarkdown(container: HTMLElement, source: string): void {
    const fragment = document.createDocumentFragment();
    const lines = source.split("\n");
    let paragraph: string[] = [];
    let list: HTMLElement | null = null;
    let codeLang = "";
    let codeLines: string[] = [];

    const flushParagraph = (): void => {
        if (paragraph.length === 0) return;
        const p = el("p.md-p");
        inlineFormat(p, paragraph.join("\n"));
        fragment.append(p);
        paragraph = [];
    };
    const flushList = (): void => {
        if (list) {
            fragment.append(list);
            list = null;
        }
    };
    const flushCode = (): void => {
        if (codeLines.length > 0) {
            fragment.append(codeBlock(codeLang, codeLines));
            codeLang = "";
            codeLines = [];
        }
    };
    const beginCode = (lang: string): void => {
        flushParagraph();
        flushList();
        codeLang = lang.trim();
        codeLines = [];
    };

    for (const raw of lines) {
        const line = raw.trimEnd();

        // Kod bloğu içindeysek sınır işaretine kadar ham satırı topla.
        if (codeLines.length > 0 || line.startsWith("```")) {
            if (line.startsWith("```")) {
                if (codeLines.length > 0) flushCode();
                else beginCode(line.slice(3));
            } else {
                codeLines.push(line);
            }
            continue;
        }

        const heading = HEADING_RE.exec(line);
        if (heading) {
            flushParagraph();
            flushList();
            const h = el(`div.md-h${heading[1]!.length}`);
            inlineFormat(h, heading[2]!.trim());
            fragment.append(h);
            continue;
        }

        const ordered = ORDERED_RE.exec(line);
        const bullet = BULLET_RE.exec(line);
        if (ordered || bullet) {
            flushParagraph();
            if (!list || (list.tagName !== (ordered ? "OL" : "UL"))) {
                flushList();
                list = el(ordered ? "ol.md-ol" : "ul.md-ul");
            }
            const item = el("li.md-li");
            inlineFormat(item, (ordered ? ordered[2] : bullet![2])!.trim());
            list.append(item);
            continue;
        }

        // Boş satır: paragrafı ve listeyi kapatır.
        if (line === "") {
            flushParagraph();
            flushList();
            continue;
        }

        flushList();
        paragraph.push(line);
    }
    flushParagraph();
    flushList();
    flushCode();
    container.append(fragment);
}

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const BULLET_RE = /^[-*]\s+(.+)$/;
const ORDERED_RE = /^\d+[.)]\s+(.+)$/;

/** Satır içi biçimlendirme: `code`, **bold**, *italic*. */
function inlineFormat(parent: HTMLElement, text: string): void {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    for (const part of parts) {
        if (!part) continue;
        if (part.startsWith("**") && part.endsWith("**")) parent.append(el("strong", { text: part.slice(2, -2) }));
        else if (part.startsWith("*") && part.endsWith("*")) parent.append(el("em", { text: part.slice(1, -1) }));
        else if (part.startsWith("`") && part.endsWith("`")) parent.append(el("code", { text: part.slice(1, -1) }));
        else parent.append(document.createTextNode(part));
    }
}

/** Kod bloğu: başlık çubuğu (dil + Kopyala) ve ön-formatlanmış gövde. */
function codeBlock(lang: string, codeLines: string[]): HTMLElement {
    const copyButton = el("button", { type: "button", class: "md-copy", text: "Copy" });
    copyButton.addEventListener("click", () => {
        const text = codeLines.join("\n");
        void navigator.clipboard.writeText(text).then(() => {
            copyButton.textContent = "Copied";
            window.setTimeout(() => (copyButton.textContent = "Copy"), 1500);
        });
    });
    const head = el("div.md-code-head", {}, el("span.md-code-lang", { text: lang || "code" }), copyButton);
    const pre = el("pre.md-code", {}, el("code", { text: codeLines.join("\n") }));
    return el("div.md-code-wrap", {}, head, pre);
}

/* ── Küçük yardımcılar ── */

function thinkingSpinner(): HTMLElement {
    const svg = createSvg("svg", { class: "thinking-spinner", viewBox: "0 0 24 24" }) as unknown as HTMLElement;
    const ring = createSvg("circle", { cx: "12", cy: "12", r: "9", fill: "none", "stroke-width": "2.5" });
    svg.appendChild(ring);
    return svg;
}

/** Düşünme bittiğinde başlıktaki ✓ ikonu. */
function checkIcon(): HTMLElement {
    const svg = createSvg("svg", { class: "thinking-check", viewBox: "0 0 24 24" }) as unknown as HTMLElement;
    svg.appendChild(
        createSvg("path", {
            d: "M5 13l4 4L19 7",
            fill: "none",
            "stroke-width": "2.5",
            "stroke-linecap": "round",
            "stroke-linejoin": "round"
        })
    );
    return svg;
}

/** Araç çipi durum ikonu: çalışırken halka, bitkende ✓/✗ rozeti. */
function chipIcon(state: "running" | "ok" | "fail"): HTMLElement {
    if (state === "running") {
        return el("span.tool-chip-icon", {}, el("span.tool-chip-spinner"));
    }
    return el("span.tool-chip-icon", { class: `tool-chip-mark is-${state}`, text: state === "ok" ? "✓" : "✗" });
}

function createSvg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
}

function summarizeArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args)
        .map(([key, value]) => `${key}=${short(String(value ?? ""))}`)
        .slice(0, 3);
    return entries.join(", ");
}

function short(text: string): string {
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

function firstLine(text: string): string {
    const line = text.split("\n")[0] ?? "";
    return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

function cssEscape(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}