import { existsSync, statSync } from "node:fs";
import { createModelDownloader } from "node-llama-cpp";
import type { ModelDefinition } from "../config/types.js";
import { resolveModelFilePath } from "../config/configManager.js";
import { getModelsDir } from "../utils/paths.js";
import { logger } from "../utils/paths.js";

export type DownloadProgress = {
    totalSize: number;
    downloadedSize: number;
    estimatedTimeLeft: number;
    averageSpeed: number;
    percent?: number;
};

export type DownloadOptions = {
    onProgress?: (progress: DownloadProgress) => void;
    signal?: AbortSignal;
};

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "?";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

export function formatTime(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "?";
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

export async function downloadModel(
    model: ModelDefinition,
    options: DownloadOptions = {}
): Promise<string> {
    const dirPath = getModelsDir();
    const targetPath = resolveModelFilePath(model);

    if (existsSync(targetPath)) {
        logger.info(`Model already present: ${targetPath}`);
        return targetPath;
    }

    logger.info(`Downloading model: ${model.uri}`);
    const downloader = await createModelDownloader({
        modelUri: model.uri,
        dirPath,
        fileName: model.fileName,
        skipExisting: true,
        deleteTempFileOnCancel: false,
        showCliProgress: false,
        onProgress: (status) => {
            options.onProgress?.(status);
        }
    });

    const downloadedPath = await downloader.download({ signal: options.signal });
    logger.info(`Model downloaded: ${downloadedPath}`);
    return downloadedPath;
}

export function getModelFileSize(path: string): number {
    try {
        return statSync(path).size;
    } catch {
        return 0;
    }
}

export function isDownloaded(model: ModelDefinition): boolean {
    return existsSync(resolveModelFilePath(model));
}
