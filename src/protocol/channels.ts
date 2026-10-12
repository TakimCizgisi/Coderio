/**
 * IPC kanal adları — çalışma zamanı sabitleri.
 *
 * `api.ts` yalnızca tip içerir; kanal adları hem ana süreç hem preload tarafından
 * kullanıldığı için burada tek yerde toplanır. Preload CJS olarak derlendiği için
 * bu modülü içe aktarmak sorun değildir.
 */

/** Ana süreçten renderer'a gönderilen motor olayları. */
export const EVENT_CHANNEL = "coderio:event";

/** Ana süreçten renderer'a gönderilen pencere durumu (maksimum değişimi). */
export const WINDOW_STATE_CHANNEL = "coderio:window-state";

/** Renderer'ın ana sürece gönderdiği motor istekleri. */
export const REQUEST_CHANNEL = "coderio:request";