import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, isAbsolute, relative } from "node:path";
import type { AgentTool } from "../config/types.js";
import { limitOutput, resolveUserPath, shouldSkipDir } from "./utils.js";

function resolvePath(cwd: string, input: string): string {
    return resolveUserPath(cwd, input);
}

function globToRegExp(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "@@DOUBLE_STAR@@")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/@@DOUBLE_STAR@@/g, ".*");
    return new RegExp(`^${escaped}$`);
}

function normalizeLines(text: string): string {
    return text.replace(/\r\n/g, "\n");
}

export const readFileTool: AgentTool = {
    name: "read_file",
    description: "Reads a file's content. For large files, partial reading with offset/limit is possible.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Path of the file to read (relative to cwd or absolute)" },
            offset: { type: "integer", description: "Start line number (1-based)" },
            limit: { type: "integer", description: "Maximum number of lines to read" }
        },
        required: ["path"]
    },
    handler: async (params: { path: string; offset?: number; limit?: number }, ctx) => {
        const filePath = resolvePath(ctx.cwd, params.path);
        if (!existsSync(filePath)) {
            return { ok: false, output: `File not found: ${params.path}` };
        }
        const stat = statSync(filePath);
        if (!stat.isFile()) {
            return { ok: false, output: `Not a file: ${params.path}` };
        }
        if (stat.size > 2 * 1024 * 1024 && !params.offset && !params.limit) {
            return {
                ok: false,
                output: `File too large (${stat.size} bytes). Read partially with offset/limit parameters.`
            };
        }
        const content = normalizeLines(readFileSync(filePath, "utf8"));
        const lines = content.split("\n");
        const totalLines = lines.length;
        const start = params.offset ? Math.max(1, params.offset) : 1;
        const end = params.limit ? Math.min(totalLines, start + params.limit - 1) : totalLines;
        const slice = lines.slice(start - 1, end);
        const numbered = slice.map((line, i) => `${String(start + i).padStart(6)} | ${line}`).join("\n");
        const header = `File: ${filePath}\nLines: ${start}-${end} / ${totalLines}\n`;
        return { ok: true, output: header + numbered };
    }
};

export const writeFileTool: AgentTool = {
    name: "write_file",
    description:
        "Writes content to a file (creates or overwrites). With append=true it appends at the end. " +
        "Folders are created automatically.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Path of the file to write" },
            content: { type: "string", description: "File content" },
            append: { type: "boolean", description: "If true, append content at the end of the file (default: false)" }
        },
        required: ["path", "content"]
    },
    handler: async (params: { path: string; content: string; append?: boolean }, ctx) => {
        const filePath = resolvePath(ctx.cwd, params.path);
        mkdirSync(dirname(filePath), { recursive: true });
        const content = normalizeLines(params.content);
        writeFileSync(filePath, content, { encoding: "utf8", flag: params.append ? "a" : "w" });
        const action = params.append ? "appended to" : "written to";
        return { ok: true, output: `File ${action}: ${filePath} (${Buffer.byteLength(content)} bytes)` };
    }
};

export const listDirTool: AgentTool = {
    name: "list_dir",
    description: "Lists files and folders in a directory. With recursive=true, subdirectories are included too.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Directory to list (default: cwd)" },
            recursive: { type: "boolean", description: "Also list subdirectories (default: false)" }
        }
    },
    handler: async (params: { path?: string; recursive?: boolean }, ctx) => {
        const dirPath = resolvePath(ctx.cwd, params.path ?? ".");
        if (!existsSync(dirPath)) {
            return { ok: false, output: `Directory not found: ${params.path ?? "."}` };
        }
        if (!statSync(dirPath).isDirectory()) {
            return { ok: false, output: `Not a directory: ${params.path ?? "."}` };
        }
        const entries: string[] = [];
        let skippedCount = 0;
        const MAX_ENTRIES = 300;
        const walk = (current: string, depth: number): void => {
            if (depth > 5 || entries.length >= MAX_ENTRIES) return;
            let children;
            try {
                children = readdirSync(current, { withFileTypes: true });
            } catch (err) {
                entries.push(`  ${"  ".repeat(depth)}[error: ${(err as Error).message}]`);
                return;
            }
            for (const child of children) {
                if (entries.length >= MAX_ENTRIES) break;
                const childPath = join(current, child.name);
                const isDir = child.isDirectory();
                if (isDir && shouldSkipDir(child.name)) {
                    skippedCount++;
                    continue;
                }
                const indent = "  ".repeat(depth);
                const rel = relative(dirPath, childPath).replace(/\\/g, "/");
                if (isDir) {
                    entries.push(`${indent}${rel}/`);
                    if (params.recursive) walk(childPath, depth + 1);
                } else {
                    let size = 0;
                    try {
                        size = statSync(childPath).size;
                    } catch {
                        size = 0;
                    }
                    entries.push(`${indent}${rel} (${size} bytes)`);
                }
            }
        };
        walk(dirPath, 0);
        let output = `Directory: ${dirPath}\n${entries.join("\n")}`;
        if (skippedCount > 0) output += `\n(... ${skippedCount} heavy/hidden folders skipped: node_modules, .git, dist, build etc.)`;
        if (entries.length >= MAX_ENTRIES) output += `\n(... reached the limit of ${entries.length} entries)`; 
        return { ok: true, output: limitOutput(output, ctx.config.maxToolOutput) };
    }
};

export const searchFilesTool: AgentTool = {
    name: "search_files",
    description: "Searches files in a directory by name pattern (glob).",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Directory to search (default: cwd)" },
            pattern: { type: "string", description: "Glob pattern, e.g. '*.ts' or '**/*.ts'" }
        },
        required: ["pattern"]
    },
    handler: async (params: { path?: string; pattern: string }, ctx) => {
        const dirPath = resolvePath(ctx.cwd, params.path ?? ".");
        const matches: string[] = [];
        const pattern = params.pattern.replace(/^\/+/, "").replace(/\\/g, "/");
        const regex = globToRegExp(pattern);
        const walk = (current: string, depth: number): void => {
            if (depth > 8) return;
            let children;
            try {
                children = readdirSync(current, { withFileTypes: true });
            } catch {
                return;
            }
            for (const child of children) {
                const childPath = join(current, child.name);
                const rel = relative(dirPath, childPath).replace(/\\/g, "/");
                if (child.isDirectory()) {
                    if (shouldSkipDir(child.name)) continue;
                    if (regex.test(`${rel}/`)) matches.push(`${rel}/`);
                    walk(childPath, depth + 1);
                } else {
                    if (regex.test(rel)) matches.push(rel);
                }
            }
        };
        walk(dirPath, 0);
        const result = matches.length > 0 ? matches.join("\n") : "No matching files found.";
        return { ok: true, output: `Glob: ${params.pattern}\n${result}` };
    }
};

export const grepTool: AgentTool = {
    name: "grep_files",
    description: "Searches inside file contents. pattern is a regex.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Directory to search (default: cwd)" },
            pattern: { type: "string", description: "Regex pattern" },
            include: { type: "string", description: "File pattern filter, e.g. '*.ts'" }
        },
        required: ["pattern"]
    },
    handler: async (params: { path?: string; pattern: string; include?: string }, ctx) => {
        const dirPath = resolvePath(ctx.cwd, params.path ?? ".");
        let regex: RegExp;
        try {
            regex = new RegExp(params.pattern);
        } catch (err) {
            return { ok: false, output: `Invalid regex pattern: ${(err as Error).message}` };
        }
        let includeRe: RegExp | null = null;
        if (params.include) {
            try {
                includeRe = new RegExp(
                    `^${params.include.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`
                );
            } catch {
                includeRe = null;
            }
        }
        const results: string[] = [];
        let fileCount = 0;
        const walk = (current: string, depth: number): void => {
            if (depth > 8 || fileCount > 500) return;
            let children;
            try {
                children = readdirSync(current, { withFileTypes: true });
            } catch {
                return;
            }
            for (const child of children) {
                if (shouldSkipDir(child.name)) continue;
                const childPath = join(current, child.name);
                if (child.isDirectory()) {
                    walk(childPath, depth + 1);
                } else {
                    if (includeRe && !includeRe.test(child.name)) continue;
                    fileCount++;
                    try {
                        if (statSync(childPath).size > 2 * 1024 * 1024) continue;
                    } catch {
                        continue;
                    }
                    try {
                        const lines = normalizeLines(readFileSync(childPath, "utf8")).split("\n");
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i] ?? "";
                            if (regex.test(line)) {
                                results.push(`${relative(dirPath, childPath).replace(/\\/g, "/")}:${i + 1}: ${line.trim().slice(0, 200)}`);
                            }
                        }
                    } catch {
                        /* okunamayan dosyayı atla */
                    }
                }
            }
        };
        walk(dirPath, 0);
        return { ok: true, output: limitOutput(results.join("\n"), ctx.config.maxToolOutput) };
    }
};
