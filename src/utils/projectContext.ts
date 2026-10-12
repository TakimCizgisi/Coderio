import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_CONTEXT_CHARS = 20_000;

const CANDIDATES = ["AGENTS.md", "CODERIO.md"] as const;

/** cwd içinde AGENTS.md veya CODERIO.md varsa içeriğini sistem promptuna eklenebilir metin olarak döndürür */
export function loadProjectContext(cwd: string): string {
    for (const name of CANDIDATES) {
        const file = join(cwd, name);
        if (!existsSync(file)) continue;
        try {
            const content = readFileSync(file, "utf8").trim();
            if (!content) return "";
            const limited = content.length > MAX_CONTEXT_CHARS ? `${content.slice(0, MAX_CONTEXT_CHARS)}\n... [project notes truncated]` : content;
            return `\n\n--- PROJECT NOTES (${name}) ---\n${limited}\n--- END PROJECT NOTES ---`;
        } catch {
            /* okunamayan not dosyasını yut */
        }
    }
    return "";
}
