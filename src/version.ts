declare const __CODERIO_VERSION__: string;

/** esbuild tarafından `package.json` sürümüyle değiştirilir. */
export const CODERIO_VERSION: string = typeof __CODERIO_VERSION__ === "string" ? __CODERIO_VERSION__ : "0.0.0-dev";

/**
 * Sürüm kodu adı.
 *
 * Coderio 0.6.0 "Phantom": AJAN AI'in yerini tamamen Coderio'ya bıraktığı
 * sürüm. Bu ad yalnızca arayüzde ve `app.getVersion()` yanında gösterilir.
 */
export const CODENAME = "Phantom";
