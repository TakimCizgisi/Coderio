/**
 * Coderio derleme betiği — dört ayrı hedef.
 *
 *  - main     ESM  `dist/main.js`       Electron ana süreç
 *  - host     ESM  `dist/host.js`       `utilityProcess` motor süreci
 *  - preload  CJS  `dist/preload.cjs`   sandbox içinde `require` gerekir
 *  - renderer IIFE `dist/renderer/app.js`
 *
 * main ve host ESM olmak zorunda: `node-llama-cpp` yalnızca ESM yayımlar ve
 * paketlenmiş uygulamada `asar: false` kullanıldığı için `type: "module"`
 * sıfır uzantılı dosyalar Node tarafından ESM olarak okunur. Preload ise
 * sandbox altında çalıştığı için CJS olarak derlenir.
 */
import { build, context } from "esbuild";
import { readFileSync, cpSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const watch = process.argv.includes("--watch");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const versionDefine = { __CODERIO_VERSION__: JSON.stringify(version) };

/** Ana süreç ve motor: Node ortamı, ESM, `electron` ve `node-llama-cpp` dışarıda. */
const nodeTarget = (entryPoints, outfile) => ({
    entryPoints,
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "info",
    legalComments: "none",
    sourcemap: watch,
    define: versionDefine,
    // `electron` CJS'dir ve içinde `require("child_process")` gibi dinamik
    // require'lar bulunur. Bundle'a girerse ESM çıktısında "Dynamic require of
    // ... is not supported" hatasıyla ana süreç hiç açılmaz. Dışarıda bırakılınca
    // çalışma zamanında Electron tarafından çözülür.
    //
    // `adm-zip` de aynı sınıf bir sorun: `util/utils.js` içinde dinamik
    // `require("fs")` çağrısı var, bundle'a girince motor süreci "Dynamic
    // require of "fs" is not supported" ile doğar. Çalışma zamanında
    // `node_modules`'den yüklenmesi gerekir.
    //
    // `node-llama-cpp` paketlenmiş uygulamada `app.asar.unpacked/node_modules`
    // altında durur; binary'leri çalıştırmak için sembolik bağ gerekir.
    external: ["electron", "node-llama-cpp", "adm-zip", "js-yaml"]
});

const targets = [
    nodeTarget(["src/main/main.ts"], "dist/main.js"),

    nodeTarget(["src/host/host.ts"], "dist/host.js"),

    {
        entryPoints: ["src/preload/preload.ts"],
        // `.cjs` şart: paket `"type": "module"` olduğu için `.js` ESM sayılır ve
        // sandbox preload CommonJS olarak yüklenemez.
        outfile: "dist/preload.cjs",
        bundle: true,
        // Sandbox preload CJS olarak yüklenir; `import.meta` kullanılamaz.
        format: "cjs",
        platform: "node",
        target: "node22",
        logLevel: "info",
        legalComments: "none",
        sourcemap: watch,
        define: versionDefine,
        external: ["electron"]
    },

    {
        entryPoints: ["src/renderer/app.ts"],
        outfile: "dist/renderer/app.js",
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "chrome130",
        logLevel: "info",
        legalComments: "none",
        sourcemap: watch,
        define: versionDefine,
        loader: { ".css": "css" },
        // CSS'teki `url(...)` referansları bundle'a gömülmez; fontlar
        // `copyStatic()` ile `dist/renderer` altına zaten düz kopyalanır ve
        // göreli yoldan yüklenir. `external` bunları esbuild'in yeniden
        // adlandırmasından (hash) ve çözememe hatasından korur.
        external: ["font.otf", "MaterialSymbolsOutlined.woff2", "LOGO.svg"]
    },

    {
        // CLI: `Coderio.exe` (ELECTRON_RUN_AS_NODE) ya da `node` ile çalışır.
        // Yalnızca ayarlar menüsüdür; model motorunu başlatmaz. `node-llama-cpp`
        // yalnızca model indirmesinde gerektiği için dışarıda bırakılır ve
        // `import()` kod bölmesine ayrılarak CLI açılışını hafif tutar.
        entryPoints: ["src/cli/index.ts"],
        outdir: "dist/cli",
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node22",
        logLevel: "info",
        legalComments: "none",
        sourcemap: watch,
        define: versionDefine,
        splitting: true,
        external: ["electron", "node-llama-cpp", "adm-zip", "js-yaml"]
    }
];

/**
 * Statik dosyalar (HTML, CSS, font, logo) derlenmeden kopyalanır.
 *
 * Arayüzün görsel varlıkları tek kaynak olarak `UI/` klasöründe tutulur ve
 * `dist/renderer` altına düz kopyalanır; böylece renderer bunlara göreli yoldan
 * (`LOGO.svg`, `font.otf`) erişir. `İNDEX.HTML` yalnızca tasarım referansıdır,
 * paketlenmez.
 */
function copyStatic() {
    const out = resolve(root, "dist/renderer");
    mkdirSync(out, { recursive: true });
    cpSync(resolve(root, "src/renderer/index.html"), resolve(out, "index.html"));
    for (const asset of ["font.otf", "LOGO.svg", "MaterialSymbolsOutlined.woff2"]) {
        cpSync(resolve(root, "UI", asset), resolve(out, asset));
    }
}

copyStatic();

if (watch) {
    for (const t of targets) {
        const ctx = await context(t);
        await ctx.watch();
    }
    console.log("[esbuild] watching (main + host + preload + renderer + cli)");
} else {
    await Promise.all(targets.map((t) => build(t)))
        .then(() => console.log(`[esbuild] ${targets.map((t) => t.outfile ?? t.outdir).join(" + ")} ready`))
        .catch(() => process.exit(1));
}

export { root };
