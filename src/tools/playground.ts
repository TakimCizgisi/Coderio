import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "../config/types.js";
import { limitOutput } from "./utils.js";

/** Kullanıcının açık klasöründe, projenin içindeki Coderio test klasörü: <cwd>/.coderio */
function playgroundPath(cwd: string): string {
    const dir = join(cwd, ".coderio");
    mkdirSync(dir, { recursive: true });
    return dir;
}

function todosPath(cwd: string): string {
    return join(playgroundPath(cwd), "todos.json");
}

type TodoItem = { text: string; done: boolean };

function loadTodos(cwd: string): TodoItem[] {
    try {
        if (existsSync(todosPath(cwd))) {
            const parsed = JSON.parse(readFileSync(todosPath(cwd), "utf8"));
            if (Array.isArray(parsed)) return parsed as TodoItem[];
        }
    } catch {
        /* bozuk dosya: sıfırla */
    }
    return [];
}

function clearDir(dir: string): number {
    let count = 0;
    for (const name of readdirSync(dir)) {
        rmSync(join(dir, name), { recursive: true, force: true });
        count++;
    }
    return count;
}

export const openPlaygroundTool: AgentTool = {
    name: "open_playground",
    description:
        "Prepares the CODERIO PLAYGROUND FOLDER (<cwd>/.coderio) inside the open folder. " +
        "Call this first when you want to run experiments/tests/prototypes. " +
        "With reset=false it keeps existing contents; with reset=true it empties the folder. " +
        "It never touches the user's real project files; all experiments happen in this folder.",
    parameters: {
        type: "object",
        properties: {
            reset: {
                type: "boolean",
                description: "If true, completely clears the .coderio contents (default: false)"
            },
            note: { type: "string", description: "Short note about what you are going to do (optional)" }
        },
        required: []
    },
    handler: async (params: { reset?: boolean; note?: string }, ctx) => {
        const dir = playgroundPath(ctx.cwd);
        const before = readdirSync(dir).length;
        let cleared = 0;
        if (params.reset) cleared = clearDir(dir);
        const after = readdirSync(dir).length;
        const lines = [
            `.coderio playground ready: ${dir}`,
            `Previous contents: ${before} items; now: ${after} items${cleared > 0 ? ` (${cleared} removed)` : ""}`
        ];
        if (params.note) lines.push(`Note: ${params.note}`);
        lines.push("RULE: run all experiments, temp files and risky tests HERE; do not touch the real project.");
        return { ok: true, output: lines.join("\n") };
    }
};

export const setTodosTool: AgentTool = {
    name: "set_todos",
    description:
        "Updates the task schedule (.coderio/todos.json). " +
        "When starting a task, first plan a short TODO list and save it with this tool. " +
        "done=false means the step is still pending, done=true means completed.",
    parameters: {
        type: "object",
        properties: {
            todos: {
                type: "array",
                description: "List of things to do",
                items: {
                    type: "object",
                    properties: {
                        text: { type: "string", description: "Step description" },
                        done: { type: "boolean", description: "Whether completed (default false)" }
                    },
                    required: ["text"]
                }
            }
        },
        required: ["todos"]
    },
    handler: async (params: { todos?: TodoItem[] }, ctx) => {
        const raw = params.todos;
        if (!raw || raw.length === 0) return { ok: false, output: "todos list cannot be empty." };
        const items: TodoItem[] = raw.map((t) => ({
            text: String(t.text ?? "").trim(),
            done: t.done === true
        }));
        if (items.some((t) => !t.text)) return { ok: false, output: "Every TODO item requires text." };
        writeFileSync(todosPath(ctx.cwd), JSON.stringify(items, null, 2), "utf8");
        const lines = items.map((t, i) => `${t.done ? "[x]" : "[ ]"} ${i + 1}. ${t.text}`);
        return {
            ok: true,
            output: `TODO list saved (${items.length} items): ${todosPath(ctx.cwd)}\n${lines.join("\n")}`
        };
    }
};

export const getTodosTool: AgentTool = {
    name: "get_todos",
    description: "Reads the task schedule (.coderio/todos.json). Returns saved TODOs if any, otherwise an empty result.",
    parameters: {
        type: "object",
        properties: {}
    },
    handler: async (_params: unknown, ctx) => {
        const items = loadTodos(ctx.cwd);
        if (items.length === 0) {
            return { ok: true, output: "No saved TODOs. Plan your work with set_todos when starting a task." };
        }
        const lines = items.map((t, i) => `${t.done ? "[x]" : "[ ]"} ${i + 1}. ${t.text}`);
        return { ok: true, output: limitOutput(`Task schedule (${items.length} items):\n${lines.join("\n")}`, ctx.config.maxToolOutput) };
    }
};