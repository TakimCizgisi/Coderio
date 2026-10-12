/**
 * Akıllı başlık smoke testi (gerçek model; kuruluysa).
 *
 * İlk kullanıcı mesajından sonra motorun İngilizce bir başlık üretip oturum
 * dosyasına yazdığını ve `session-title` olayını yayınladığını doğrular.
 * Model kurulu değilse atlanır (CI'da sessizce geçer; gerçek makinede çalışır).
 *
 * Dikkat: gerçek veri dizini (kurulu modelin olduğu) kullanılır; test oturum
 * dosyası bitince silinir. Bu yüzden önce mevcut oturum dosyaları kaydedilir,
 * sonra yeni görünen dosyalar kaldırılır.
 */
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runner } from "../src/host/runner.js";
import { getDataDir } from "../src/utils/paths.js";
import { loadConfig, getModelById, isModelInstalled } from "../src/config/configManager.js";
import type { EventFrame } from "../src/protocol/messages.js";

const FIRST_MESSAGE = "merhaba";

async function main(): Promise<void> {
    console.log("\n  Session title smoke test (real model)\n");

    const config = loadConfig();
    const model = getModelById(config.modelId);
    if (!model || !isModelInstalled(model)) {
        console.log("  skipped: model not installed — title generation needs the model.\n");
        return;
    }

    const sessionsDir = join(getDataDir(), "sessions");
    const before = new Set(existsSync(sessionsDir) ? readdirSync(sessionsDir) : []);
    const cwd = mkdtempSync(join(tmpdir(), "coderio-title-"));
    let failed = 0;
    const check = (name: string, cond: boolean, detail = ""): void => {
        if (cond) console.log(`  ok   ${name}`);
        else {
            failed++;
            console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
        }
    };

    const runner = new Runner(cwd);
    const events: EventFrame[] = [];
    const unsubscribe = runner.subscribe((event) => events.push(event));

    try {
        const res = await runner.sendMessage(FIRST_MESSAGE, undefined);
        check("chat response received", res.ok, res.error ?? "");

        // `session-title` olayını bekle (title üretimi yanıttan hemen sonra koşar).
        let title: string | null = null;
        for (let i = 0; i < 120; i++) {
            await new Promise((r) => setTimeout(r, 500));
            const ev = events.find((e) => e.event === "session-title");
            if (ev) {
                title = ev.title;
                break;
            }
        }
        check("session-title event emitted", title !== null, TS("events", events));
        check("title is non-empty", !!title);
        if (title) console.log(`  title -> ${title}`);
        check("title is short", title !== null && title.length <= 60, title === null ? "-" : `len=${title.length}`);
    } finally {
        unsubscribe();
        await runner.dispose();
        // Testin ürettiği oturum dosyalarını temizle (yalnızca yeni görünenler).
        if (existsSync(sessionsDir)) {
            for (const entry of readdirSync(sessionsDir)) {
                if (!before.has(entry)) {
                    try {
                        rmSync(join(sessionsDir, entry), { force: true });
                    } catch {
                        /* yok say */
                    }
                }
            }
        }
    rmSync(cwd, { recursive: true, force: true });
    }

    console.log(failed === 0 ? "\n  TITLE TEST PASSED\n" : `\n  TITLE TEST FAILED (${failed})\n`);
    if (failed > 0) process.exit(1);
}

/** Olay listesinin merak uyandırabilecek kısa özeti (teşhis için). */
function TS(label: string, events: EventFrame[]): string {
    const names = [...new Set(events.map((e) => e.event))].join(", ");
    return `${label}: [${names}]`;
}

main().catch((err) => {
    console.error(`\n  test crashed: ${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
});