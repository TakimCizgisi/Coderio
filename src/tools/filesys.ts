import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentTool } from "../config/types.js";
import { resolveUserPath } from "./utils.js";

export const moveFileTool: AgentTool = {
    name: "move_file",
    description:
        "Moves / renames a file or folder. The target directory is created if missing. Never overwrites an existing file.",
    parameters: {
        type: "object",
        properties: {
            source: { type: "string", description: "Source path" },
            destination: { type: "string", description: "Target path (file or folder)" }
        },
        required: ["source", "destination"]
    },
    handler: async (params: { source?: string; destination?: string }, ctx) => {
        const src = params.source?.trim();
        const dest = params.destination?.trim();
        if (!src || !dest) return { ok: false, output: "source and destination are required." };
        const srcPath = resolveUserPath(ctx.cwd, src);
        const destPath = resolveUserPath(ctx.cwd, dest);
        if (srcPath === destPath) return { ok: false, output: "Source and target are the same." };
        if (!existsSync(srcPath)) return { ok: false, output: `Source not found: ${src}` };
        if (existsSync(destPath)) return { ok: false, output: `Target already exists: ${dest} (delete it first)` };
        try {
            mkdirSync(dirname(destPath), { recursive: true });
            renameSync(srcPath, destPath);
            return { ok: true, output: `Moved: ${srcPath} → ${destPath}` };
        } catch (err) {
            return { ok: false, output: `Move failed: ${(err as Error).message}` };
        }
    }
};

export const deleteFileTool: AgentTool = {
    name: "delete_file",
    description:
        "Deletes a file or folder. Folders require recursive:true. Use with care — this cannot be undone.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Path to delete" },
            recursive: { type: "boolean", description: "Delete the folder with its contents (default: false)" }
        },
        required: ["path"]
    },
    handler: async (params: { path?: string; recursive?: boolean }, ctx) => {
        const p = params.path?.trim();
        if (!p) return { ok: false, output: "path is required." };
        const target = resolveUserPath(ctx.cwd, p);
        if (!existsSync(target)) return { ok: false, output: `Not found: ${p}` };
        const cwdResolved = resolve(ctx.cwd);
        if (target === cwdResolved || cwdResolved.startsWith(target + "\\") || cwdResolved.startsWith(target + "/")) {
            return { ok: false, output: "You cannot delete the working directory or any of its parents." };
        }
        const stat = statSync(target);
        const isDir = stat.isDirectory();
        if (isDir && !params.recursive) {
            return { ok: false, output: `"${p}" is a folder; pass recursive:true to delete it.` };
        }
        try {
            rmSync(target, { recursive: isDir, force: true });
            return { ok: true, output: `Deleted: ${target}${isDir ? " (folder)" : ""}` };
        } catch (err) {
            return { ok: false, output: `Delete failed: ${(err as Error).message}` };
        }
    }
};
