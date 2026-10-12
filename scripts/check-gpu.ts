/**
 * GPU validation tool.
 *
 * Separates two distinct questions:
 *   1. Does this machine support CUDA/Vulkan?  → getLlamaGpuTypes("supported")
 *   2. Does the engine actually run on the GPU? → getLlama(...) + Llama.gpu
 *
 * Question 1 can be "yes" while question 2 is "no": if the prebuilt CUDA binary
 * cannot be used on this system, getLlama({gpu:"cuda"}) fails. This tool shows
 * which backend the engine actually picks and states concretely why CUDA is not
 * being used.
 *
 *   npm run check:gpu
 */
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import { getLlama, getLlamaGpuTypes, LlamaLogLevel } from "node-llama-cpp";
import { LlamaEngine } from "../src/engine/llama.js";
import { listInstalledModels, loadConfig } from "../src/config/configManager.js";

const CHAIN = ["cuda", "vulkan"] as const;

/**
 * `ggml-cuda.dll` does not embed the CUDA runtime; it depends on the DLLs below
 * dynamically. These do not ship with node-llama-cpp packages; they come from an
 * NVIDIA CUDA runtime installation. When they are missing, the CUDA backend
 * silently fails to load and the engine reports "GPU type = CPU".
 *
 * The list is aligned with the DLLs imported by the llama.cpp v0.4.0 / CUDA 13 binary.
 */
const CUDA_RUNTIME_DLLS = ["cublas64_13.dll", "nvcudart_hybrid64.dll"];

function findOnPath(fileName: string): string | null {
    const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    dirs.push(join(process.env.SystemRoot ?? "C:\\Windows", "System32"));
    for (const dir of dirs) {
        const candidate = join(dir, fileName);
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

/** When the CUDA load fails, list the missing runtime libraries. */
function reportCudaRuntime(): void {
    const missing = CUDA_RUNTIME_DLLS.filter((dll) => findOnPath(dll) === null);
    if (missing.length === 0) {
        console.log("    CUDA runtime looks complete.");
        return;
    }
    console.log(`    Missing CUDA runtime: ${missing.join(", ")}`);
    console.log("    → Install the NVIDIA CUDA 13 runtime (cublas / cudart).");
    console.log("      Re-run this tool after installing.");
}

/**
 * `listInstalledModels()` returns `{ model, path, installed }` per entry.
 * Joining directly produces `[object Object]`; the name is in `model.name`.
 */
function describeInstalledModels(): string {
    const models = listInstalledModels().filter((entry) => entry.installed);
    if (models.length === 0) return "none";
    return models.map((entry) => entry.model.name).join(", ");
}

async function main(): Promise<void> {
    const config = loadConfig();
    const supported = await LlamaEngine.detectSupportedGpus();
    const allValid = await getLlamaGpuTypes("allValid").catch(() => []);

    console.log("\n  Coderio GPU check\n");
    console.log(`    config.gpu        : ${config.gpu}`);
    console.log(`    config.gpuLayers  : ${config.gpuLayers}`);
    console.log(`    config.modelId    : ${config.modelId}`);
    console.log(`    drivers supported : ${supported.join(", ") || "none"}`);
    console.log(`    possibly usable   : ${allValid.filter((g) => typeof g === "string").join(", ")}`);

    console.log("\n  Backend attempts (real load):");
    let loaded: string | null = null;
    for (const gpu of CHAIN) {
        try {
            const llama = await getLlama({ gpu, logLevel: LlamaLogLevel.error, progressLogs: false, skipDownload: true });
            const active = llama.gpu === false ? "cpu" : llama.gpu;
            const offload = llama.supportsGpuOffloading;
            console.log(`    ${gpu.padEnd(8)} -> ${active.padEnd(8)} layer offload: ${offload ? "on" : "off"}`);
            if (active !== "cpu") {
                loaded = active;
                await llama.dispose();
                break;
            }
            await llama.dispose();
        } catch (err) {
            const reason = (err as Error).message.split("\n")[0]?.trim().slice(0, 90) ?? "unknown error";
            console.log(`    ${gpu.padEnd(8)} -> UNAVAILABLE (${reason})`);
            if (gpu === "cuda") {
                reportCudaRuntime();
            }
        }
    }

    console.log();
    if (loaded) {
        console.log(`  The engine will use the GPU via "${loaded}" on this machine.`);
    } else {
        console.log("  ! CUDA and Vulkan are unavailable; the engine will fall back to CPU.");
    }

    console.log(`  Installed model: ${describeInstalledModels()}`);
    if (listInstalledModels().length === 0) {
        console.log("  (Install a model first for a real inference test: engine.installModel(id))");
    }
    console.log();
}

main().catch((err) => {
    console.error(`\n  check failed: ${(err as Error).message}\n`);
    process.exit(1);
});