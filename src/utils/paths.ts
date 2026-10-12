import { mkdirSync, appendFileSync, existsSync, readdirSync, renameSync, cpSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

const levelOrder: Record<LogLevel, number> = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4
};

/** Her seviyedeki logu (debug dahil) diskteki günlüğe de yazar. */
function writeLogFile(level: string, prefix: string, ...args: unknown[]): void {
    try {
        const line = `[${new Date().toISOString()}] [${level}] ${prefix} ${args
            .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
            .join(" ")}\n`;
        appendFileSync(join(getLogDir(), "coderio.log"), line);
    } catch {
        /* log dosyasına yazılamazsa sessizce geç */
    }
}

function log(level: LogLevel, tag: string, ...args: unknown[]): void {
    const prefix = `[${tag}]`;
    if (levelOrder[level] <= levelOrder[currentLevel]) {
        if (level === "error") {
            console.error(prefix, ...args);
        } else if (level === "warn") {
            console.warn(prefix, ...args);
        } else {
            console.log(prefix, ...args);
        }
    }
    writeLogFile(level, prefix, ...args);
}

export const logger = {
    error: (...args: unknown[]) => log("error", "error", ...args),
    warn: (...args: unknown[]) => log("warn", "warn", ...args),
    info: (...args: unknown[]) => log("info", "info", ...args),
    debug: (...args: unknown[]) => log("debug", "debug", ...args)
};

/** AJAN 0.5.x'in veri dizini. Coderio'ya geçişte model dosyaları taşınır. */
const LEGACY_DIR_NAME = ".ajan";

/**
 * Veri dizinini bulur, yoksa oluşturur.
 *
 * `CODERIO_HOME` verilmişse ona saygı durur ve taşıma yapılmaz. Aksi hâlde
 * yeni dizin boş değilse hiçbir şeye dokunmaz; eski AJAN dizini varsa ilk
 * açılışta tamamen taşınır (modeller GB boyutunda, yeniden indirilmez).
 */
export function getDataDir(): string {
    const override = process.env.CODERIO_HOME;
    if (override) {
        mkdirSync(override, { recursive: true });
        return override;
    }
    const base = join(os.homedir(), ".coderio");
    if (!existsSync(base) || isEmptyDir(base)) migrateLegacyDataDir(base);
    mkdirSync(base, { recursive: true });
    return base;
}

/** Klasörde kullanıcıya ait hiçbir şey yok mu (gizli dosyalar sayılmaz)? */
function isEmptyDir(dir: string): boolean {
    try {
        return readdirSync(dir).filter((name) => !name.startsWith(".")).length === 0;
    } catch {
        return false;
    }
}

/**
 * `~/.ajan` → `~/.coderio` tek seferlik taşıma.
 *
 * Önce adlandırma dener (anlık, disk yazmaz); çapraz birim/kilit durumunda
 * kopyalamaya düşer. Yarım kalan taşımanın veri kaybı yaratmaması için
 * hedefe yalnızca tamamen boşken dokunulur.
 */
function migrateLegacyDataDir(target: string): void {
    const legacy = join(os.homedir(), LEGACY_DIR_NAME);
    if (!existsSync(legacy)) return;
    try {
        renameSync(legacy, target);
        migrateLog(`Legacy data directory moved: ${legacy} -> ${target}`);
        return;
    } catch {
        /* cross-device etc.; fall back to copy */
    }
    try {
        cpSync(legacy, target, { recursive: true, errorOnExist: false, force: true });
        migrateLog(`Legacy data directory copied: ${legacy} -> ${target}`);
    } catch (err) {
        migrateLog(`Failed to migrate legacy data directory (${legacy}): ${String(err)}`);
    }
}

/**
 * Taşıma sırasında `logger` kullanılamaz: log yazmak `getLogDir()` çağırır,
 * o da `getDataDir()`'a geri döner. Bu yüzden yalnızca konsola yazılır.
 */
function migrateLog(message: string): void {
    process.stdout.write(`[coderio-migrate] ${message}\n`);
}

export function getModelsDir(): string {
    const dir = join(getDataDir(), "models");
    mkdirSync(dir, { recursive: true });
    return dir;
}

export function getConfigPath(): string {
    return join(getDataDir(), "config.json");
}

export function getCacheDir(): string {
    const dir = join(getDataDir(), "cache");
    mkdirSync(dir, { recursive: true });
    return dir;
}

export function getLogDir(): string {
    const dir = join(getDataDir(), "logs");
    mkdirSync(dir, { recursive: true });
    return dir;
}
