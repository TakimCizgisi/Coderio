/**
 * GPU durum raporu.
 *
 * Önemli ayrım: "bu makine CUDA'yı destekliyor" ile "motor CUDA üzerinde
 * çalışıyor" aynı şey değildir. Kurulu build'de CUDA ikilisi yoksa
 * node-llama-cpp sessizce CPU'ya düşer. Bu yüzden `active` alanı yalnızca
 * `Llama.gpu`'dan okunur, `supported` listesinden değil.
 */
import type { CoderioService } from "../service.js";
import type { GpuReport } from "../protocol/messages.js";

export function backendLabel(id: string): string {
    switch (id) {
        case "cuda":
            return "NVIDIA CUDA";
        case "vulkan":
            return "Vulkan";
        case "metal":
            return "Apple Metal";
        case "cpu":
            return "CPU";
        default:
            return id;
    }
}

export async function buildGpuReport(service: CoderioService): Promise<GpuReport> {
    const status = await service.getGpuStatus();
    return {
        active: status.active?.backend ?? "not-loaded",
        offload: status.active?.offload ?? false,
        vramMb: status.vramMb,
        layers: status.layers,
        supported: status.supported,
        preferred: status.preferred,
        fallback: status.fallback
    };
}

/** Tek satırlık insan okunur özet (CLI `status` çıktısı için). */
export function formatGpu(gpu: GpuReport): string {
    if (gpu.active === "not-loaded") {
        const candidates = gpu.supported.length > 0 ? gpu.supported.join(", ") : "none";
        return `not loaded (available: ${candidates})`;
    }
    const parts = [backendLabel(gpu.active)];
    if (gpu.active !== "cpu") {
        parts.push(gpu.offload ? "layer offload on" : "no layer offload");
        if (gpu.layers > 0) parts.push(`${gpu.layers} layers`);
        if (gpu.vramMb > 0) parts.push(`${gpu.vramMb} MB VRAM`);
    }
    if (gpu.fallback) parts.push(`requested ${gpu.preferred} unavailable`);
    return parts.join(" · ");
}
