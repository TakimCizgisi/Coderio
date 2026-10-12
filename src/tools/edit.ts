import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { AgentTool } from "../config/types.js";
import { resolveUserPath } from "./utils.js";

function normalizeLines(text: string): string {
    return text.replace(/\r\n/g, "\n");
}

export const editFileTool: AgentTool = {
    name: "edit_file",
    description:
        "Replaces exact-matching old text with new text in a file (targeted edit). " +
        "The old text must appear exactly ONCE in the file; if it appears multiple times, use replaceAll=true. " +
        "More reliable than write_file for small, targeted changes.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Path of the file to edit" },
            oldString: { type: "string", description: "Existing text to replace (exact match)" },
            newString: { type: "string", description: "New text that replaces the old text" },
            replaceAll: { type: "boolean", description: "If true, replace all occurrences (default: false)" },
            cwd: { type: "string", description: "Directory where relative paths are resolved" }
        },
        required: ["path", "oldString", "newString"]
    },
    handler: async (params: { path: string; oldString: string; newString: string; replaceAll?: boolean; cwd?: string }, ctx) => {
        const filePath = resolveUserPath(params.cwd ?? ctx.cwd, params.path);
        if (!existsSync(filePath)) {
            return { ok: false, output: `File not found: ${params.path}` };
        }
        const original = normalizeLines(readFileSync(filePath, "utf8"));
        const oldText = normalizeLines(params.oldString);
        const newText = normalizeLines(params.newString);

        if (oldText.length === 0) {
            return { ok: false, output: "oldString cannot be empty." };
        }

        const count = original.split(oldText).length - 1;
        if (count === 0) {
            return { ok: false, output: `No match found: "${params.oldString.slice(0, 120)}". The file content may have changed; check with read_file.` };
        }
        if (count > 1 && !params.replaceAll) {
            return {
                ok: false,
                output: `"${params.oldString.slice(0, 120)}" appears ${count} times in the file. Target a single occurrence or use replaceAll=true.`
            };
        }

        const result = params.replaceAll ? original.split(oldText).join(newText) : original.replace(oldText, newText);
        writeFileSync(filePath, result, "utf8");
        return { ok: true, output: `File edited: ${filePath} (${params.replaceAll ? count : 1} replacements)` };
    }
};
