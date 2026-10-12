/**
 * IPC smoke testi: gerçek motor, süreç içi MessagePort üzerinden.
 *
 * Motor `worker_threads.Worker` içinde çalıştırılır: `utilityProcess.fork()`
 * ile aynı kod yolu (`src/host/serve.ts`) ve aynı kanal (`EngineChannel`)
 * kullanılır, ancak test Electron'a ihtiyaç duymaz. Named pipe / socket yoktur.
 *
 * Model yüklemez (modeller kurulu olmayabilir) ama istek/yanıt eşleme, olay
 * yayını, hata zarfı ve kapanış davranışını doğrular.
 */
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineChannel } from "../src/protocol/channel.js";
import type { EventFrame, Request, Result } from "../src/protocol/messages.js";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
    if (cond) {
        passed++;
        console.log(`  ✔ ${name}`);
    } else {
        failed++;
        console.log(`  ✖ ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

type Harness = {
    channel: EngineChannel;
    events: EventFrame[];
    worker: Worker;
    /** Kanal kapatıldığında sözü verilen kapanış sebebi. */
    closeReason: string;
};

/** Test sonunda hepsinin gerçekten kapandığından emin olmak için. */
const workers: Worker[] = [];

/**
 * Motoru bir Worker'da başlatır ve ana süreç tarafındaki kanalı kurar.
 *
 * Worker `execArgv`'yi devraldığı için `tsx` yükleyicisi TS dosyasını
 * doğrudan çalıştırabilir; ayrı bir derleme adımı gerekmez.
 */
async function startEngine(cwd: string): Promise<Harness> {
    const worker = new Worker(join(import.meta.dirname, "ipc-worker.ts"), {
        workerData: { cwd },
        execArgv: process.execArgv
    });
    workers.push(worker);
    worker.stderr.on("data", (d) => process.stderr.write(`  [engine] ${d}`));

    const events: EventFrame[] = [];
    const harness: Harness = {
        channel: undefined as unknown as EngineChannel,
        events,
        worker,
        closeReason: ""
    };
    harness.channel = new EngineChannel(
        worker,
        (event) => events.push(event as EventFrame),
        (err) => {
            harness.closeReason = err?.message ?? "closed";
        }
    );

    worker.once("error", (err) => {
        harness.closeReason = err.message;
        harness.channel.close(err.message);
    });
    // Üretimde de aynı bağ vardır: `engineHost.ts`, `utilityProcess` çıktığında
    // kanalı kapatır. Kanal kendi başına alt sürecin ölümünü öğrenemez.
    worker.on("exit", (code) => {
        if (!harness.closeReason) harness.closeReason = `engine exited (code ${code})`;
        harness.channel.close(harness.closeReason);
    });
    return harness;
}

async function main(): Promise<void> {
    console.log("\n  Coderio IPC smoke test (via worker_threads)\n");

    // Motorun veri dizinini testin kendi dizinine yönlendir: kullanıcının
    // gerçek `~/.coderio` verisine dokunulmasın.
    const dataDir = mkdtempSync(join(tmpdir(), "coderio-smoke-"));
    const cwd = mkdtempSync(join(tmpdir(), "coderio-proje-"));
    process.env.CODERIO_HOME = dataDir;

    const engine = await startEngine(cwd);

    try {
        // 1) Bağlantı + ping
        const pong = await engine.channel.request<Extract<Result, { type: "pong" }>>({ type: "ping" });
        check("ping response received", pong.ok && pong.result.version.length > 0);
        check("protocol version 1", pong.ok && pong.result.protocol === 1);

        // 2) Durum raporu
        const st = await engine.channel.request<Extract<Result, { type: "status" }>>({ type: "status" });
        check("status returned", st.ok && typeof st.result.status.version === "string");
        check("gpu report present", st.ok && typeof st.result.status.gpu === "object");
        check("working dir correct", st.ok && st.result.status.cwd === cwd, st.ok ? st.result.status.cwd : "-");
        check("data dir tied to CODERIO_HOME", st.ok && st.result.status.config.modelId.length > 0);

        // 3) Model listesi boş olabilir ama istek hata vermemeli
        const models = await engine.channel.request<Extract<Result, { type: "models" }>>({ type: "list-models" });
        check("list-models responded", models.ok && Array.isArray(models.result.models));

        // 4) Bilinmeyen istek hata zarfı döner (sessizce yutulmaz)
        const bad = await engine.channel.request({ type: "unknown" } as unknown as Request);
        check(
            "unknown request rejected",
            !bad.ok && typeof bad.error === "string",
            bad.ok ? "no error returned" : bad.error
        );

        // 5) Olay yayını: model kurulu değilse hata olayı üretilmeli
        const chat = await engine.channel.request<Extract<Result, { type: "ok" }>>({ type: "chat", text: "hello" });
        await new Promise((r) => setTimeout(r, 400));
        check("chat request returned a result", chat.ok && typeof chat.result.type === "string");
        check(
            "event stream reached renderer",
            engine.events.length > 0,
            `${engine.events.length} events`
        );

        // 6) Kanal kapanınca bekleyen istek asılı kalmamalı
        const hangPromise = engine.channel.request({ type: "status" });
        engine.channel.close("close test");
        const hang = await hangPromise;
        check("pending request resolved on close", !hang.ok);

        // 7) Kapanmış kanala istek hata döndürmeli (çökmemeli)
        const afterClose = await engine.channel.request({ type: "ping" });
        check("closed channel rejected request", !afterClose.ok);

        // 8) `shutdown` motor sürecini sonlandırmalı
        const engine2 = await startEngine(cwd);
        const shut = await engine2.channel.request<Extract<Result, { type: "shutdown" }>>({ type: "shutdown" });
        check("shutdown accepted", shut.ok && shut.result.type === "shutdown");
        await new Promise((r) => setTimeout(r, 600));
        check("channel closed after shutdown", engine2.closeReason.length > 0, engine2.closeReason);
    } finally {
        // `Worker`ın `close()`'ı yoktur; süreci sonlandıran yöntem `terminate()`.
        // Kanal kapatmak yetmez, aksi hâlde Node süreci hiç çıkmaz.
        await Promise.all(workers.splice(0).map((w) => w.terminate()));
        rmSync(dataDir, { recursive: true, force: true });
        rmSync(cwd, { recursive: true, force: true });
    }

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error(`\n  test crashed: ${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
});
