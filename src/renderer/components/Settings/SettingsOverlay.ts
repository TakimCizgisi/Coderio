import { el, mount, clear } from "../../core/dom.js";
import { icon, ICONS } from "../../core/icons.js";
import { app as appApi, request } from "../../core/engine.js";
import type { CoderioConfig, GpuBackend, ModelEntry, Result } from "../../../protocol/api.js";

export type SettingsOverlay = {
    open: () => void;
    close: () => void;
    toggle: () => void;
    root: HTMLElement;
};

const MODEL_ACTIONS = ["use-model", "install-model", "remove-model"] as const;
type ModelAction = (typeof MODEL_ACTIONS)[number];

const GPU_BACKENDS: GpuBackend[] = ["auto", "cuda", "metal", "vulkan"];

/**
 * Ayarlar penceresi (full-window overlay).
 *
 * `Home` yeniden kurulsa da kalıcıdır: `document.body`'ye doğrudan eklenir,
 * ASCII/CSS sınıfları sorumluluğu ayrıdır. Sekmelerin her biri açılışta
 * motor protokolünden veri çeker.
 */
export function SettingsOverlay(): SettingsOverlay {
    const root = el("div.settings-overlay", {}, el("div.settings-scrim"));
    const body = el("div.settings-body");
    const views = {
        models: el("div.settings-view"),
        config: el("div.settings-view"),
        about: el("div.settings-view")
    };
    const closeButton = el("button", { type: "button", class: "settings-close", "aria-label": "Close settings" }, icon(ICONS.close));
    const panel = el(
        "section.settings-panel",
        {},
        el("header.settings-header", {}, el("span.settings-title", { text: "Settings" }), closeButton),
        el("nav.settings-tabs", {}, tab("models", "Models"), tab("config", "Config"), tab("about", "About")),
        body
    );
    mount(root, panel);
    mount(body, views.models, views.config, views.about);
    // Uygulama açılışında görünmemelidir; yalnızca `open()` ile gösterilir.
    root.hidden = true;

    function activate(tabName: string): void {
        for (const tab of panel.querySelectorAll(".settings-tab")) {
            tab.classList.toggle("is-active", (tab as HTMLButtonElement).dataset.tab === tabName);
        }
        views.models.hidden = tabName !== "models";
        views.config.hidden = tabName !== "config";
        views.about.hidden = tabName !== "about";
    }

    panel.querySelectorAll(".settings-tab").forEach((tab) => {
        (tab as HTMLButtonElement).addEventListener("click", () => activate((tab as HTMLButtonElement).dataset.tab ?? "models"));
    });

    function close(): void {
        root.hidden = true;
    }
    function open(): void {
        root.hidden = false;
        activate("models");
        void loadModels(views.models);
        void loadConfig(views.config);
        void loadAbout(views.about);
    }

    closeButton.addEventListener("click", close);
    root.querySelector(".settings-scrim")?.addEventListener("pointerdown", close);
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
    });

    return { open, close, toggle: () => (root.hidden ? open() : close()), root };
}

function tab(name: string, label: string): HTMLButtonElement {
    return el("button", { type: "button", class: "settings-tab", "data-tab": name, text: label });
}

/* ── Models ── */

async function loadModels(view: HTMLElement): Promise<void> {
    clear(view);
    mount(view, el("div.settings-empty", { text: "Loading…" }));

    const res = await request<Extract<Result, { type: "models" }>>({ type: "list-models" }).catch(() => null);
    clear(view);
    if (!res || res.error) {
        mount(view, el("div.settings-empty", { text: res?.error ?? "Could not load the model list." }));
        return;
    }

    const list = el("div.settings-list");
    for (const entry of res.models) mount(list, modelRow(entry, () => loadModels(view)));
    mount(view, list);

    const toolbar = el("div.settings-toolbar");
    const refresh = el("button", { type: "button", class: "settings-action", text: "Refresh model list" });
    refresh.addEventListener("click", () => {
        refresh.disabled = true;
        void (async () => {
            const r = await request<Extract<Result, { type: "models-refreshed" }>>({ type: "refresh-models" }).catch(() => null);
            refresh.disabled = false;
            mount(view, el("div.settings-note", { text: r?.ok ? `Updated the catalog: ${r.count} models.` : r?.error ?? "Could not refresh the catalog." }));
            await loadModels(view);
        })();
    });
    const count = res.models.length;
    mount(toolbar, refresh, el("span.settings-note", { text: `${count} model${count === 1 ? "" : "s"} in the catalog.` }));
    mount(view, toolbar);
}

function modelRow(entry: ModelEntry, onChanged: () => void): HTMLElement {
    const name = el("div.settings-item-name", { text: entry.model.name });
    const meta = el("div.settings-item-meta", { text: entry.model.id });
    const badges = el("div.settings-item-badges");
    if (entry.active) mount(badges, el("span.settings-badge.settings-badge-active", { text: "ACTIVE" }));
    mount(badges, el("span.settings-badge" + (entry.installed ? ".settings-badge-installed" : ""), { text: entry.installed ? "INSTALLED" : "INTEGRATED" }));

    const actions = el("div.settings-item-actions");
    const useButton = el("button", { type: "button", class: "settings-action", text: "Use" });
    useButton.disabled = entry.active;
    useButton.addEventListener("click", () => void mutate({ type: "use-model", id: entry.model.id }, onChanged));
    actions.append(useButton);

    if (entry.installed) {
        const remove = el("button", { type: "button", class: "settings-action", text: "Remove" });
        remove.addEventListener("click", () => void mutate({ type: "remove-model", id: entry.model.id }, onChanged));
        actions.append(remove);
    } else {
        const install = el("button", { type: "button", class: "settings-action", text: "Install" });
        install.addEventListener("click", () => void mutate({ type: "install-model", id: entry.model.id }, onChanged));
        actions.append(install);
    }

    return el("div.settings-item", {}, el("div.settings-item-main", {}, name, meta, badges), actions);
}

async function mutate(req: { type: ModelAction; id: string }, onChanged: () => Promise<void> | void): Promise<void> {
    const res = await request<Extract<Result, { type: "model" }>>(req).catch(() => null);
    await Promise.resolve(onChanged());
    const view = document.querySelector(".settings-view:not([hidden])");
    if (view && (!res || !res.ok)) {
        mount(view, el("div.settings-note.settings-note-error", { text: `Failed: ${res?.error ?? "request error"}` }));
    }
}

/* ── Config ── */

type ConfigField = {
    label: string;
    value: () => string;
    input: HTMLInputElement | HTMLSelectElement;
};

async function loadConfig(view: HTMLElement): Promise<void> {
    clear(view);
    mount(view, el("div.settings-empty", { text: "Loading…" }));

    const st = await request<Extract<Result, { type: "status" }>>({ type: "status" }).catch(() => null);
    const cfg = st?.status.config;
    clear(view);
    if (!cfg) {
        mount(view, el("div.settings-empty", { text: "Could not read the configuration." }));
        return;
    }

    const fields: ConfigField[] = [
        textField("Context size (number or auto)", String(cfg.contextSize ?? "auto")),
        selectField("GPU backend", GPU_BACKENDS, cfg.gpu ?? "auto"),
        textField("GPU layers (number, auto, max)", String(cfg.gpuLayers ?? "max")),
        textField("Temperature (0–2)", String(cfg.session?.temperature ?? 0.6)),
        textField("Top-K", String(cfg.session?.topK ?? 64)),
        textField("Top-P (0–1)", String(cfg.session?.topP ?? 0.9)),
        textField("Max tokens", String(cfg.session?.maxTokens ?? 2048)),
        textField("Max steps", String(cfg.maxSteps ?? 25)),
        textField("Max tool output (chars)", String(cfg.maxToolOutput ?? 40000)),
        textField("Tool timeout (ms)", String(cfg.toolTimeout ?? 60000)),
        textField("Context trim threshold (0–1)", String(cfg.contextTrimThreshold ?? 0.8))
    ];

    const form = el("div.settings-form");
    for (const field of fields) mount(form, fieldRow(field));

    const beep = el("input", { type: "checkbox" }) as HTMLInputElement;
    beep.checked = cfg.beepOnComplete === true;
    mount(form, el("label.settings-field", {}, el("span.settings-field-label", { text: "Beep when a task completes" }), beep));

    const autostart = el("input", { type: "checkbox" }) as HTMLInputElement;
    autostart.checked = cfg.autostartModel !== false;
    mount(form, el("label.settings-field", {}, el("span.settings-field-label", { text: "Auto-start the model at launch (off = load on the first message)" }), autostart));

    const blocked = el("textarea.settings-blocked", { rows: "2", placeholder: "regex patterns, comma separated" }) as HTMLTextAreaElement;
    blocked.value = (cfg.blockedCommands ?? []).join(", ");
    mount(form, el("label.settings-field", {}, el("span.settings-field-label", { text: "Blocked commands (comma separated; empty = allow all)" }), blocked));

    const note = el("span.settings-note");
    const apply = el("button", { type: "button", class: "settings-action settings-apply", text: "Apply settings" });
    apply.addEventListener("click", () => void applyConfig(fields, beep, autostart, blocked, note));

    mount(view, form, el("div.settings-toolbar", {}, apply, note));
}

function textField(label: string, value: string): ConfigField {
    const input = el("input", { type: "text", inputmode: "decimal" }) as HTMLInputElement;
    input.value = value;
    return { label, input, value: () => input.value };
}

function selectField(label: string, options: string[], value: string): ConfigField {
    const input = el(
        "select",
        {},
        ...options.map((option) => el("option", { value: option, text: option }))
    ) as HTMLSelectElement;
    input.value = value;
    return { label, input, value: () => input.value };
}

function fieldRow(field: ConfigField): HTMLElement {
    return el("label.settings-field", {}, el("span.settings-field-label", { text: field.label }), field.input);
}

async function applyConfig(fields: ConfigField[], beep: HTMLInputElement, autostart: HTMLInputElement, blocked: HTMLTextAreaElement, note: HTMLElement): Promise<void> {
    const valueOf = (label: string): string => fields.find((f) => f.label === label)?.value() ?? "";
    const num = (label: string): number | undefined => {
        const raw = valueOf(label).trim();
        if (raw === "" || raw === "auto" || raw === "max") return undefined;
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
    };

    const patch: Record<string, unknown> = {};

    const ctx = num("Context size (number or auto)");
    if (ctx !== undefined) patch.contextSize = ctx;
    else if (valueOf("Context size (number or auto)").trim() === "auto") patch.contextSize = "auto";

    const gpu = valueOf("GPU backend").trim() as GpuBackend;
    if (gpu) patch.gpu = gpu;

    const layersRaw = valueOf("GPU layers (number, auto, max)").trim();
    if (layersRaw === "auto" || layersRaw === "max") patch.gpuLayers = layersRaw;
    else {
        const n = Number(layersRaw);
        if (Number.isFinite(n)) patch.gpuLayers = Math.floor(n);
    }

    const sessionPatch: Record<string, number> = {};
    const setSession = (key: string, pluck: number | undefined, floor?: boolean): void => {
        if (pluck === undefined) return;
        sessionPatch[key] = floor ? Math.floor(pluck) : pluck;
    };
    setSession("temperature", num("Temperature (0–2)"));
    setSession("topK", num("Top-K"), true);
    setSession("topP", num("Top-P (0–1)"));
    setSession("maxTokens", num("Max tokens"), true);
    if (Object.keys(sessionPatch).length > 0) patch.session = sessionPatch;

    const steps = num("Max steps");
    if (steps !== undefined) patch.maxSteps = Math.floor(steps);
    const toolOutput = num("Max tool output (chars)");
    if (toolOutput !== undefined) patch.maxToolOutput = Math.floor(toolOutput);
    const toolTimeout = num("Tool timeout (ms)");
    if (toolTimeout !== undefined) patch.toolTimeout = Math.floor(toolTimeout);
    const trim = num("Context trim threshold (0–1)");
    if (trim !== undefined) patch.contextTrimThreshold = trim;

    const list = blocked.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    patch.blockedCommands = list;
    patch.beepOnComplete = beep.checked;
    patch.autostartModel = autostart.checked;

    note.textContent = "Saving…";
    const res = await request<Extract<Result, { type: "config" }>>({ type: "set-config", patch }).catch(() => null);
    note.textContent = res ? "Saved." : "Could not save the configuration.";
}

/* ── About ── */

async function loadAbout(view: HTMLElement): Promise<void> {
    clear(view);
    const info = await appApi.info().catch(() => null);
    if (info) {
        mount(view, el("div.settings-about-line", { text: `Version: ${info.version} "${info.codename}"` }));
        mount(view, el("div.settings-about-line", { text: `Platform: ${info.platform}` }));
    } else {
        mount(view, el("div.settings-about-line", { text: "Version: unknown" }));
    }

    const toolbar = el("div.settings-toolbar");
    const dataDir = el("button", { type: "button", class: "settings-action", text: "Open data directory" });
    dataDir.addEventListener("click", () => void appApi.revealDataDir());
    const restart = el("button", { type: "button", class: "settings-action", text: "Restart app" });
    restart.addEventListener("click", () => void appApi.restart());
    mount(toolbar, dataDir, restart);
    mount(view, toolbar);
}