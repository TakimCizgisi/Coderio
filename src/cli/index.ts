import { createInterface } from "node:readline";
import {
    DEFAULT_CONFIG,
    ensureConfigDir,
    getModelById,
    getModelsRegistry,
    listInstalledModels,
    loadConfig,
    refreshRemoteModels,
    removeModelFile,
    saveConfig
} from "../config/configManager.js";
import { getConfigPath, setLogLevel } from "../utils/paths.js";
import { CODERIO_VERSION } from "../version.js";
import type { CoderioConfig, GpuBackend } from "../config/types.js";

const VERSION = CODERIO_VERSION;

setLogLevel("silent");
ensureConfigDir();

const rl = createInterface({ input: process.stdin, output: process.stdout });

process.on("SIGINT", () => {
    process.stdout.write("\n");
    process.exit(130);
});

function ask(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
}

function printBanner(): void {
    const line = "-".repeat(50);
    console.log(`${line}`);
    console.log("  \x1b[36m█▀▀ █▀█ █▀▄\x1b[0m  Coderio " + VERSION + " — settings CLI");
    console.log("  \x1b[36m█▄▄ █▄█ █▄▀\x1b[0m  no model engine");
    console.log(`${line}`);
    console.log(`  Config file: ${getConfigPath()}`);
    console.log(line);
}

async function selectFromItems<T>(title: string, items: T[], labelOf: (item: T) => string): Promise<T | null> {
    console.log(title);
    for (let i = 0; i < items.length; i++) {
        console.log(`  ${i + 1}. ${labelOf(items[i]!)}`);
    }
    console.log(`  0. Back`);
    while (true) {
        const input = (await ask("> ")).trim();
        if (input === "" || input === "0") return null;
        const n = Number(input);
        if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1] ?? null;
        console.log("  Invalid choice.");
    }
}

async function confirm(question: string): Promise<boolean> {
    const answer = (await ask(`${question} (y/N) `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
}

async function showConfig(cfg: CoderioConfig): Promise<void> {
    const session = cfg.session ?? {};
    console.log(`\n  Model        : ${cfg.modelId}`);
    console.log(`  Context size : ${cfg.contextSize}`);
    console.log(`  GPU          : ${cfg.gpu ?? "auto"} / layers ${cfg.gpuLayers}`);
    console.log(`  Temperature  : ${session.temperature ?? "default"}`);
    console.log(`  Top-K / Top-P: ${session.topK ?? "default"} / ${session.topP ?? "default"}`);
    console.log(`  Max tokens   : ${session.maxTokens ?? "default"}`);
    console.log(`  Max steps    : ${cfg.maxSteps ?? "default"}`);
    console.log(`  Max tool out : ${cfg.maxToolOutput ?? "default"}`);
    console.log(`  Tool timeout : ${cfg.toolTimeout ?? "default"}`);
    console.log(`  Trim thresh. : ${cfg.contextTrimThreshold ?? "default"}`);
    console.log(`  Beep on done : ${cfg.beepOnComplete ? "yes" : "no"}`);
    console.log(`  Blocked cmds : ${(cfg.blockedCommands ?? []).length} pattern(s)`);
    console.log(`  Remote models: ${cfg.remoteModelsUrl ?? "default"}`);
    console.log(`  Active project: ${cfg.activeProject ?? "none"}`);
}

function save(cfg: CoderioConfig): void {
    saveConfig(cfg);
    console.log(`  Saved: ${getConfigPath()}\n`);
}

async function menuModel(cfg: CoderioConfig): Promise<void> {
    const list = listInstalledModels();
    const registry = getModelsRegistry();
    console.log(`\n  Models: ${registry.length} available, ${list.filter((m) => m.installed).length} installed\n`);
    for (const entry of list) {
        const mark = entry.installed ? "INSTALLED" : "not installed";
        console.log(`    - ${entry.model.name} (${entry.model.id}) [${mark}]`);
    }

    while (true) {
        const action = await selectFromItems(
            "\n  Actions:",
            [
                { key: "select", label: "Select default model" },
                { key: "download", label: "Download a model" },
                { key: "remove", label: "Remove a model" },
                { key: "refresh", label: "Refresh remote model list" },
                { key: "current", label: "Show current model" }
            ],
            (a) => a.label
        );
        if (!action) return;

        if (action.key === "select") {
            const model = await selectFromItems(
                "\n  Pick the default model:",
                registry,
                (m) => `${m.name} (${m.id})${list.find((l) => l.model.id === m.id)?.installed ? " [INSTALLED]" : ""}`
            );
            if (!model) continue;
            cfg.modelId = model.id;
            save(cfg);
            return;
        }

        if (action.key === "download") {
            const model = await selectFromItems(
                "\n  Pick a model to download:",
                registry,
                (m) =>
                    `${m.name} (${m.id})${m.size ? ` ~${(m.size / (1024 * 1024 * 1024)).toFixed(2)} GB` : ""}` +
                    `${list.find((l) => l.model.id === m.id)?.installed ? " [INSTALLED]" : ""}`
            );
            if (!model) continue;
            if (list.find((l) => l.model.id === model.id)?.installed) {
                console.log("  This model is already installed.\n");
                continue;
            }
            if (!(await confirm(`  Download "${model.name}"?`))) continue;
            try {
                const { downloadModel, formatBytes, formatTime } = await import("../engine/modelManager.js");
                const started = Date.now();
                let lastPct = -1;
                const target = await downloadModel(model, {
                    onProgress: (p) => {
                        const pct = typeof p.percent === "number" ? Math.round(p.percent) : p.percent;
                        if (pct === lastPct) return;
                        lastPct = pct ?? -1;
                        const pctText = pct == null ? "?" : `${pct}%`;
                        process.stdout.write(`\r  Downloading: ${pctText}  ${formatBytes(p.downloadedSize)} / ${formatBytes(p.totalSize)}`);
                    }
                });
                process.stdout.write("\r  Download complete.                    \n");
                console.log(`  Model: ${target} (${formatTime(Date.now() - started)})\n`);
            } catch (err) {
                process.stdout.write("\n");
                console.error(`  Download failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }

        if (action.key === "remove") {
            const installed = list.filter((l) => l.installed);
            if (installed.length === 0) {
                console.log("  No installed models to remove.\n");
                continue;
            }
            const entry = await selectFromItems(
                "\n  Pick a model to remove:",
                installed,
                (e) => `${e.model.name} (${e.model.id})  ${e.path}`
            );
            if (!entry) continue;
            if (!(await confirm(`  Delete model "${entry.model.name}"?`))) continue;
            if (removeModelFile(entry.model)) {
                console.log(cfg.modelId === entry.model.id ? "  Removed the active model; set a new default.\n" : "  Removed.\n");
            } else {
                console.log("  Remove failed.\n");
            }
            return;
        }

        if (action.key === "refresh") {
            console.log("  Refreshing remote model list (network)...\n");
            const models = await refreshRemoteModels(cfg.remoteModelsUrl ?? DEFAULT_CONFIG.remoteModelsUrl);
            console.log(`  Remote model list refreshed: ${models.length} models (last match wins over bundled).\n`);
            return;
        }

        if (action.key === "current") {
            const current = getModelById(cfg.modelId);
            if (current) console.log(`\n  ${current.name} (${current.id})\n  ${current.description ?? ""}\n`);
            continue;
        }
    }
}

async function menuContext(cfg: CoderioConfig): Promise<void> {
    console.log("\n  Context & session — leave blank to keep the current value:\n");
    const session = cfg.session ?? {};

    const ctxInput = (await ask(`  Context size [${cfg.contextSize}]: `)).trim();
    if (ctxInput !== "") {
        if (ctxInput === "auto") cfg.contextSize = "auto";
        else {
            const n = Number(ctxInput);
            if (Number.isFinite(n) && n >= 512) cfg.contextSize = Math.floor(n);
            else console.log("  Ignored — context size must be a number >= 512 or 'auto'.");
        }
    }

    const temp = (await ask(`  Temperature (0–2) [${session.temperature ?? "0.6"}]: `)).trim();
    if (temp !== "") {
        const n = Number(temp);
        if (Number.isFinite(n) && n >= 0 && n <= 2) session.temperature = n;
        else console.log("  Ignored — temperature must be between 0 and 2.");
    }

    const topK = (await ask(`  Top-K [${session.topK ?? "64"}]: `)).trim();
    if (topK !== "") {
        const n = Number(topK);
        if (Number.isFinite(n) && n >= 1) session.topK = Math.floor(n);
        else console.log("  Ignored — Top-K must be >= 1.");
    }

    const topP = (await ask(`  Top-P (0–1) [${session.topP ?? "0.9"}]: `)).trim();
    if (topP !== "") {
        const n = Number(topP);
        if (Number.isFinite(n) && n >= 0 && n <= 1) session.topP = n;
        else console.log("  Ignored — Top-P must be between 0 and 1.");
    }

    const maxTokens = (await ask(`  Max tokens [${session.maxTokens ?? "2048"}]: `)).trim();
    if (maxTokens !== "") {
        const n = Number(maxTokens);
        if (Number.isFinite(n) && n >= 1) session.maxTokens = Math.floor(n);
        else console.log("  Ignored — max tokens must be >= 1.");
    }

    const maxSteps = (await ask(`  Max steps [${cfg.maxSteps ?? "25"}]: `)).trim();
    if (maxSteps !== "") {
        const n = Number(maxSteps);
        if (Number.isFinite(n) && n >= 1) cfg.maxSteps = Math.floor(n);
        else console.log("  Ignored — max steps must be >= 1.");
    }

    const maxToolOutput = (await ask(`  Max tool output, chars [${cfg.maxToolOutput ?? "40000"}]: `)).trim();
    if (maxToolOutput !== "") {
        const n = Number(maxToolOutput);
        if (Number.isFinite(n) && n >= 500) cfg.maxToolOutput = Math.floor(n);
        else console.log("  Ignored — max tool output must be >= 500.");
    }

    const toolTimeout = (await ask(`  Tool timeout, ms [${cfg.toolTimeout ?? "60000"}]: `)).trim();
    if (toolTimeout !== "") {
        const n = Number(toolTimeout);
        if (Number.isFinite(n) && n >= 1000) cfg.toolTimeout = Math.floor(n);
        else console.log("  Ignored — tool timeout must be >= 1000 ms.");
    }

    const trim = (await ask(`  Context trim threshold (0–1) [${cfg.contextTrimThreshold ?? "0.8"}]: `)).trim();
    if (trim !== "") {
        const n = Number(trim);
        if (Number.isFinite(n) && n >= 0 && n <= 1) cfg.contextTrimThreshold = n;
        else console.log("  Ignored — threshold must be between 0 and 1.");
    }

    cfg.session = session;
    save(cfg);
}

async function menuGpu(cfg: CoderioConfig): Promise<void> {
    const backends: GpuBackend[] = ["auto", "cuda", "vulkan", "metal"];
    console.log(`\n  GPU backend: current "${cfg.gpu ?? "auto"}"\n`);
    const chosen = await selectFromItems("  Pick a backend:", backends, (b) => b);
    if (!chosen) return;
    cfg.gpu = chosen;

    const layers = (await ask(`  GPU layers [${cfg.gpuLayers ?? "max"}] (number, auto, max): `)).trim();
    if (layers !== "") {
        if (layers === "auto" || layers === "max") cfg.gpuLayers = layers;
        else {
            const n = Number(layers);
            if (Number.isFinite(n) && n >= 0) cfg.gpuLayers = Math.floor(n);
            else console.log("  Ignored — GPU layers must be a number >= 0, 'auto' or 'max'.");
        }
    }
    save(cfg);
}

async function menuAdvanced(cfg: CoderioConfig): Promise<void> {
    console.log("\n  Advanced:\n");

    const cb = (await ask(`  Blocked commands, comma separated ([] = allow all) [\`${(cfg.blockedCommands ?? []).join(", ")}\`]: `)).trim();
    if (cb !== "") {
        if (cb === "[]") cfg.blockedCommands = [];
        else cfg.blockedCommands = cb.split(",").map((s) => s.trim()).filter(Boolean);
    }

    const remote = (await ask(`  Remote models URL [\`${cfg.remoteModelsUrl ?? "default"}\`]: `)).trim();
    if (remote !== "" && remote !== "default") cfg.remoteModelsUrl = remote.trim();

    const beep = (await ask(`  Beep when task completes (y/N) [${cfg.beepOnComplete ? "yes" : "no"}]: `)).trim().toLowerCase();
    if (beep === "y" || beep === "yes") cfg.beepOnComplete = true;
    else if (beep === "n" || beep === "no") cfg.beepOnComplete = false;

    if (await confirm("\n  Reset ALL settings to defaults?")) {
        cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CoderioConfig;
        cfg.systemPrompt = undefined;
    }
    save(cfg);
}

async function main(): Promise<void> {
    printBanner();
    console.log(
        "\n  This CLI edits the shared config file. A running Coderio window reads it\n  at startup — last writer wins, and there is no live sync.\n"
    );
    console.log("  Tip: installed systems also expose this as the `coderio` command.\n");

    let cfg = loadConfig(true);
    while (true) {
        console.log(`
  [1] Model
  [2] Context & session
  [3] GPU
  [4] Advanced
  [5] Show settings
  [0] Exit`);
        const choice = (await ask("> ")).trim();
        cfg = loadConfig(true);
        switch (choice) {
            case "1":
                await menuModel(cfg);
                break;
            case "2":
                await menuContext(cfg);
                break;
            case "3":
                await menuGpu(cfg);
                break;
            case "4":
                await menuAdvanced(cfg);
                break;
            case "5":
                await showConfig(cfg);
                break;
            case "0":
            case "":
                console.log("\n  Bye.\n");
                rl.close();
                return;
            default:
                console.log("  Invalid choice.\n");
        }
    }
}

void main();