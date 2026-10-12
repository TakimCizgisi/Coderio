import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import AdmZip from "adm-zip";
import type { AgentTool } from "../config/types.js";
import { limitOutput, resolveUserPath } from "./utils.js";

function describeStructure(value: unknown, depth = 0): string {
    if (depth > 2) return typeof value;
    if (Array.isArray(value)) {
        const sample = value.slice(0, 3).map((v) => describeStructure(v, depth + 1));
        return `array[${value.length}]<${sample.join(", ")}${value.length > 3 ? ", …" : ""}>`;
    }
    if (value && typeof value === "object") {
        const keys = Object.keys(value as Record<string, unknown>);
        const shown = keys.slice(0, 12).map((k) => `${k}: ${describeStructure((value as Record<string, unknown>)[k], depth + 1)}`);
        return `object{${keys.length}}{ ${shown.join(", ")}${keys.length > 12 ? ", …" : ""} }`;
    }
    if (typeof value === "string") return `string(${value.length})`;
    return String(value);
}

export const readDataTool: AgentTool = {
    name: "read_data",
    description:
        "Parses a JSON or YAML file and returns its summary and structure. Ideal for inspecting configuration files.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "JSON/YAML file path" }
        },
        required: ["path"]
    },
    handler: async (params: { path?: string }, ctx) => {
        const p = params.path?.trim();
        if (!p) return { ok: false, output: "path is required." };
        const filePath = resolveUserPath(ctx.cwd, p);
        if (!existsSync(filePath)) return { ok: false, output: `File not found: ${p}` };
        if (!statSync(filePath).isFile()) return { ok: false, output: `Not a file: ${p}` };
        const ext = extname(filePath).toLowerCase();
        let data: unknown;
        try {
            const raw = readFileSync(filePath, "utf8");
            if (ext === ".yaml" || ext === ".yml") {
                data = loadYaml(raw);
            } else if (ext === ".json") {
                data = JSON.parse(raw);
            } else {
                try {
                    data = JSON.parse(raw);
                } catch {
                    data = loadYaml(raw);
                }
            }
        } catch (err) {
            return { ok: false, output: `Parse error: ${(err as Error).message}` };
        }
        const pretty = JSON.stringify(data, null, 2);
        const summary = `File: ${filePath}\nStructure: ${describeStructure(data)}\n\n${pretty}`;
        return { ok: true, output: limitOutput(summary, Math.min(ctx.config.maxToolOutput ?? 40_000, 20_000)) };
    }
};

export const unzipFileTool: AgentTool = {
    name: "unzip_file",
    description: "Extracts a ZIP archive into a target folder. If no target is given, extracts next to the zip.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "ZIP file path" },
            destination: { type: "string", description: "Target folder (optional)" }
        },
        required: ["path"]
    },
    handler: async (params: { path?: string; destination?: string }, ctx) => {
        const p = params.path?.trim();
        if (!p) return { ok: false, output: "path is required." };
        const zipPath = resolveUserPath(ctx.cwd, p);
        if (!existsSync(zipPath)) return { ok: false, output: `File not found: ${p}` };
        let destDir: string;
        if (params.destination?.trim()) {
            destDir = resolveUserPath(ctx.cwd, params.destination.trim());
            if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        } else {
            destDir = resolve(zipPath, "..");
        }
        try {
            const zip = new AdmZip(zipPath);
            const entries = zip.getEntries();
            zip.extractAllTo(destDir, true);
            const names = entries
                .filter((e) => !e.isDirectory)
                .slice(0, 30)
                .map((e) => e.entryName);
            const more = entries.length > 30 ? `\n… and ${entries.length - 30} more files` : "";
            return { ok: true, output: `${entries.length} entries extracted → ${destDir}\n${names.join("\n")}${more}` };
        } catch (err) {
            return { ok: false, output: `Extraction failed: ${(err as Error).message}` };
        }
    }
};
