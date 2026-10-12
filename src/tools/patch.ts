import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentTool } from "../config/types.js";
import { logger } from "../utils/paths.js";
import { resolveUserPath } from "./utils.js";

function resolvePath(cwd: string, input: string): string {
    return resolveUserPath(cwd, input);
}

type Hunk = {
    oldStart: number;
    newStart: number;
    lines: { type: " " | "+" | "-"; text: string }[];
};

function parseUnifiedDiff(diff: string): { file: string; hunks: Hunk[] } | null {
    const lines = diff.replace(/\r\n/g, "\n").split("\n");
    let file: string | undefined;
    const hunks: Hunk[] = [];
    let current: Hunk | undefined;

    for (const rawLine of lines) {
        if (rawLine.startsWith("--- ")) {
            file = rawLine.slice(4).replace(/^\s*[ab]\//, "").trim();
            continue;
        }
        if (rawLine.startsWith("+++ ")) continue;
        const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rawLine);
        if (hunkMatch) {
            current = {
                oldStart: parseInt(hunkMatch[1] ?? "1", 10),
                newStart: parseInt(hunkMatch[3] ?? "1", 10),
                lines: []
            };
            hunks.push(current);
            continue;
        }
        if (!current) continue;
        if (rawLine.startsWith("+")) {
            current.lines.push({ type: "+", text: rawLine.slice(1) });
        } else if (rawLine.startsWith("-")) {
            current.lines.push({ type: "-", text: rawLine.slice(1) });
        } else if (rawLine.startsWith(" ")) {
            current.lines.push({ type: " ", text: rawLine.slice(1) });
        } else if (rawLine.startsWith("\\")) {
            continue;
        }
    }

    if (!file || hunks.length === 0) return null;
    return { file, hunks };
}

function applyHunks(original: string, hunks: Hunk[]): { result: string; changedLines: number } {
    const lines = original.split("\n");
    const newLines: string[] = [];
    let oldLine = 1;
    let changedLines = 0;

    for (const hunk of hunks) {
        while (oldLine < hunk.oldStart && oldLine <= lines.length) {
            newLines.push(lines[oldLine - 1] ?? "");
            oldLine++;
        }
        let oldPos = hunk.oldStart;
        let contextMatched = true;
        const contextCheck = hunk.lines.filter((l) => l.type !== "+");
        for (const cl of contextCheck) {
            const current = lines[oldPos - 1];
            if (current !== cl.text) {
                contextMatched = false;
                break;
            }
            oldPos++;
        }
        if (!contextMatched) {
            throw new Error(
                `Hunk lines do not match (around line ${hunk.oldStart}). The file content may have changed.`
            );
        }
        for (const line of hunk.lines) {
            if (line.type === "-") {
                oldLine++;
                changedLines++;
            } else if (line.type === "+") {
                newLines.push(line.text);
                changedLines++;
            } else {
                newLines.push(line.text);
                oldLine++;
            }
        }
        oldPos = 0;
    }
    while (oldLine <= lines.length) {
        newLines.push(lines[oldLine - 1] ?? "");
        oldLine++;
    }
    return { result: newLines.join("\n"), changedLines };
}

export const applyPatchTool: AgentTool = {
    name: "apply_patch",
    description:
        "Applies a unified diff patch to a file. Prefer write_file for complete file rewrites. " +
        "Patch format: --- a/path + +++ b/path + @@ -oldStart,oldCount +newStart,newCount @@ + lines. " +
        "More reliable for small, targeted changes.",
    parameters: {
        type: "object",
        properties: {
            patch: { type: "string", description: "Unified diff content to apply" },
            cwd: { type: "string", description: "Directory where relative paths are resolved" }
        },
        required: ["patch"]
    },
    handler: async (params: { patch: string; cwd?: string }, ctx) => {
        const parsed = parseUnifiedDiff(params.patch);
        if (!parsed) {
            return { ok: false, output: "No valid unified diff found. --- a/path and @@ hunk lines are required." };
        }
        const filePath = resolvePath(params.cwd ?? ctx.cwd, parsed.file);
        if (!existsSync(filePath)) {
            return { ok: false, output: `File to patch not found: ${parsed.file}` };
        }
        const original = readFileSync(filePath, "utf8");
        try {
            const { result, changedLines } = applyHunks(original, parsed.hunks);
            writeFileSync(filePath, result, "utf8");
            logger.debug(`Patch applied: ${filePath} (${changedLines} lines changed)`);
            return { ok: true, output: `Patch applied: ${filePath} (${changedLines} lines changed)` };
        } catch (err) {
            return { ok: false, output: `Patch failed: ${(err as Error).message}` };
        }
    }
};

export { parseUnifiedDiff };
