import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "../config/types.js";
import { limitOutput } from "./utils.js";

type Note = { id: number; text: string; createdAt: string };

type NotesFile = { notes: Note[] };

function notesPath(): string {
    const base = process.env.CODERIO_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".coderio");
    return join(base, "notes.json");
}

function loadNotes(): NotesFile {
    try {
        if (existsSync(notesPath())) {
            const parsed = JSON.parse(readFileSync(notesPath(), "utf8")) as Partial<NotesFile>;
            return { notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
        }
    } catch {
        /* bozuk dosya: sıfırla */
    }
    return { notes: [] };
}

function saveNotes(data: NotesFile): void {
    writeFileSync(notesPath(), JSON.stringify(data, null, 2), "utf8");
}

export const noteAddTool: AgentTool = {
    name: "not_al",
    description:
        "Adds a note to persistent memory. Use for user preferences, project decisions, important information. " +
        "Notes survive across sessions (~/.coderio/notes.json).",
    parameters: {
        type: "object",
        properties: {
            text: { type: "string", description: "Note text to save" }
        },
        required: ["text"]
    },
    handler: async (params: { text?: string }) => {
        const text = (params.text ?? "").trim();
        if (!text) return { ok: false, output: "Note text cannot be empty." };
        const data = loadNotes();
        const id = data.notes.reduce((max, n) => Math.max(max, n.id), 0) + 1;
        data.notes.push({ id, text, createdAt: new Date().toISOString() });
        saveNotes(data);
        return { ok: true, output: `Note #${id} saved.` };
    }
};

export const noteReadTool: AgentTool = {
    name: "not_oku",
    description:
        "Reads notes from persistent memory. If query is given, returns notes containing that word; otherwise the last 30 notes.",
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "Word to search for in notes (optional)" }
        },
        required: []
    },
    handler: async (params: { query?: string }, ctx) => {
        const data = loadNotes();
        let notes = data.notes;
        const q = params.query?.trim().toLowerCase();
        if (q) notes = notes.filter((n) => n.text.toLowerCase().includes(q));
        if (notes.length === 0) return { ok: true, output: q ? `No notes matching "${params.query}".` : "No notes in memory." };
        const slice = notes.slice(-30);
        const lines = slice.map((n) => `#${n.id} [${n.createdAt.slice(0, 10)}] ${n.text}`);
        const header = `${notes.length} note${q ? ` ("${params.query}")` : ""}${notes.length > slice.length ? ` (showing last ${slice.length})` : ""}:\n`;
        return { ok: true, output: limitOutput(header + lines.join("\n"), ctx.config.maxToolOutput) };
    }
};
