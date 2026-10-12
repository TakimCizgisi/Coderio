/**
 * Motor sürecinin (host) yaşam döngüsü.
 *
 * `utilityProcess.fork()` ile gizli bir alt süreç başlatılır ve mesaj kanalı
 * üzerinden `EngineChannel` kurulur. Süreç çökerse kanal kapanır; bir sonraki
 * `ensure()` çağrısında yeniden başlatılır.
 *
 * Önemli: `ELECTRON_RUN_AS_NODE` **ayarlanmaz**. `utilityProcess` zaten
 * Electron'un gömülü Node çekirdeğini çalıştırır (sistemde Node kurulu
 * olması gerekmez), ama bu modda `process.parentPort` kaybolur ve alt süreç
 * `host.ts` içindeki korumada `throw` fırlatıp daha ilk log satırından önce
 * ölür. `process.versions.electron` de tanımsız kalır; `node-llama-cpp` bu
 * değere bakarak bağlama testinde `utilityProcess` yolunu seçer.
 *
 * Bu modül `electron` içe aktarır; yalnızca ana süreçte çalışır.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { utilityProcess, type UtilityProcess } from "electron";
import { EngineChannel, type MessageEndpoint } from "../protocol/channel.js";
import type { EventFrame } from "../protocol/messages.js";
import { logger } from "../utils/paths.js";

/** Yeniden başlatma denemeleri arasındaki başlangıç ve tavan süresi. */
const RETRY_INITIAL_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * `logger` üzerinde çağrılabilecek metot adları.
 *
 * `LogLevel` ayrıca `"silent"` içerir; bu bir metot değil, günlük kapatma
 * seviyesidir.
 */
type LoggerMethod = "error" | "warn" | "info" | "debug";

/** `dist/` içinden `src/main/` konumuna göre derlenmiş host dosyası. */
function hostEntry(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.join(here, "host.js");
}

/**
 * `utilityProcess` nesnesinin kendisi mesaj taşıyıcısıdır; ayrı bir
 * `MessagePortMain` aktarımı gerekmez. Alt süreç `process.parentPort`'u
 * otomatik olarak alır ve `postMessage`/`on("message")` çifti doğrudan
 * çalışır.
 *
 * Not: Electron'un belgelediği şekilde ana süreç tarafı **ham değeri** alır
 * (`on("message", (message) => ...)`), alt süreç tarafı ise `MessageEvent`
 * zarfı alır. Zarfın açılması `src/host/host.ts` tarafında yapılır.
 */
function mainEndpoint(child: UtilityProcess): MessageEndpoint {
    return {
        postMessage: (message: unknown) => child.postMessage(message),
        on: (event, listener) => child.on(event, listener)
    };
}

/**
 * Alt sürecin çıktısını ana loga taşır.
 *
 * `stdio: "pipe"` kullanılır ve akışlar mutlaka tüketilir; tüketilmezse çocuk
 * boru tamponu dolduğunda yazmaya çalışıp bloke olur. Satır sonu gelene kadar
 * biriktirilir ki yarım satırlar iki ayrı kayıt olarak görünmesin.
 */
function forwardOutput(stream: NodeJS.ReadableStream | null | undefined, level: LoggerMethod, tag: string): void {
    if (!stream) return;
    let pending = "";
    stream.setEncoding?.("utf8");
    stream.on("data", (chunk: string) => {
        const lines = (pending + chunk).split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
            if (line.trim()) logger[level](`[${tag}] ${line}`);
        }
    });
    stream.on("end", () => {
        if (pending.trim()) logger[level](`[${tag}] ${pending.trim()}`);
        pending = "";
    });
}

/** Bir `spawn` çaşrısının ürettiği çocuk + kanal eşleşmesi. */
type Spawn = { child: UtilityProcess; channel: EngineChannel };

export type EngineHostEvents = {
    /** Motor olayı (token, araç çağrısı, yükleme ilerlemesi ...) */
    onEvent: (event: EventFrame) => void;
    /** Motor beklenmedik şekilde kapandı (çökme veya kapanma). */
    onClose: (reason: string) => void;
};

export class EngineHost {
    private current: Spawn | undefined;
    private starting: Promise<EngineChannel> | undefined;
    private cwd: string;
    /** Beklenmeyen kapanış sayısı; geri çekilme süresini belirler. */
    private failures = 0;
    /** Bu zaman damgasından önce yeni süreç doğurulmaz (kısa devre). */
    private retryAt = 0;

    constructor(private readonly events: EngineHostEvents, cwd: string) {
        this.cwd = cwd;
    }

    /** Motor çalışıyorsa kanalı döner, değilse başlatır. */
    async ensure(): Promise<EngineChannel> {
        if (this.current) return this.current.channel;

        // Kısa devre: sürekli çöken bir motor için her istekte yeni süreç
        // doğurmak, uygulamayı kullanılamaz hâle getiren bir fırtınadır.
        const waitMs = this.retryAt - Date.now();
        if (waitMs > 0) {
            throw new Error(`engine restart in backoff (${Math.ceil(waitMs / 1000)}s remaining)`);
        }

        this.starting ??= Promise.resolve(this.spawn()).finally(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    /** Çalışma dizinini değiştirir; değişiklik bir sonraki başlatmada geçerli. */
    setCwd(cwd: string): void {
        this.cwd = cwd;
    }

    /** Motoru nazikçe kapatır; süreç zaten yoksa hiçbir şey yapmaz. */
    async stop(): Promise<void> {
        const spawn = this.current;
        // Önce `current`i düşür: böylece sürecin normal kapanışı hata sayılmaz ve
        // geri çekilme sayacı sıfırlanır.
        this.current = undefined;
        this.failures = 0;
        this.retryAt = 0;
        if (!spawn) return;

        await spawn.channel.request({ type: "shutdown" }).catch(() => ({ ok: false, error: "closed" }));
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                spawn.child.kill();
                resolve();
            }, 3000);
            spawn.child.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    private spawn(): EngineChannel {
        const child = utilityProcess.fork(hostEntry(), ["--cwd", this.cwd], {
            serviceName: "Coderio Engine",
            env: { ...process.env, CODERIO_LOG_LEVEL: process.env.CODERIO_LOG_LEVEL ?? "info" },
            // Çıktı ana loga yönlendirilir; `inherit` kullanılırsa alt sürecin
            // hatası stdout'a kaçar ve log dosyasında hiç görünmez.
            stdio: "pipe"
        });

        // Kanal `fork()` dönüşünde hazırdır: alt süreç `process.parentPort`'u
        // otomatik alır, dolayısıyla port aktarımını beklemek gerekmez.
        const channel = new EngineChannel(mainEndpoint(child), (event) => this.events.onEvent(event as EventFrame), () => {});
        const spawn: Spawn = { child, channel };
        this.current = spawn;

        forwardOutput(child.stdout, "info", "engine");
        forwardOutput(child.stderr, "error", "engine");

        // `pid` yalnızca `spawn` olayından sonra dolar; daha erken okunursa
        // `undefined` loglanır.
        child.on("spawn", () => {
            logger.info(`engine process started (pid ${child.pid}, cwd ${this.cwd})`);
        });

        // `error` dinlenmezse EventEmitter bunu yakalanmamış istisna sayar ve
        // ana süreç düşer. Electron bu olayı `(type, location, report)` ile
        // verir: `report` Node tanı verisi raporudur, asıl sebep oradadır.
        child.on("error", (type, location, report) => {
            logger.error(`engine process ${type} (${location}): ${String(report).slice(0, 2000)}`);
            this.handleGone(spawn, `engine process ${type}`);
        });

        child.on("exit", (code) => {
            logger.info(`engine process exited (code ${code})`);
            this.handleGone(spawn, `engine process exited (code ${code})`);
        });

        logger.info(`starting engine (cwd ${this.cwd})`);
        return channel;
    }

    /**
     * Motor kapandı: kanalı kapat, renderer'a bildir, yeniden denemeyi geciktir.
     *
     * Yalnızca **bu** `spawn` nesnesinin kapanışını işler. `stop()` sırasında
     * `current` önceden düşürüldüğü için normal kapanış buraya girmez; eski bir
     * sürecin geç gelen `exit` olayı da yok sayılır. Bu sayede her ölüm için
     * tek uyarı yazılır.
     */
    private handleGone(spawn: Spawn, reason: string): void {
        if (this.current !== spawn) return;
        this.current = undefined;

        this.failures += 1;
        const backoff = Math.min(RETRY_INITIAL_MS * 2 ** (this.failures - 1), RETRY_MAX_MS);
        this.retryAt = Date.now() + backoff;
        logger.warn(`${reason} — retrying in ${backoff / 1000}s`);

        spawn.channel.close(reason);
        this.events.onClose(reason);
    }
}