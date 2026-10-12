/**
 * Derleme ve paketleme artıklarını siler.
 *
 * Silinenler: `dist/` (esbuild çıktısı) ve `release/` (electron-builder
 * paketleri). `build/` silinmez — ikon elle üretilir ve kaynak kodla birlikte
 * sürümlenir.
 *
 * Sıra önemlidir: `release/` önce, `dist/` en son denenir. Windows Defender
 * gibi güvenlik yazılımları electron-builder'ın yazdığı ikilileri kısa süre
 * kilitleyebildiği için `release/` silinemeyebilir. Böyle bir durumda `dist/`
 * silinirse, sonraki `electron-builder` çağrısı eksik derleme çıktısıyla
 * boşuna uğraşır (giriş dosyası bulunamaz). Bu yüzden silme hataları biriktirilir
 * ve script, uyarı vererek normal şekilde sonlanır.
 */
import { rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = ["release", "dist"];
const failures = [];

for (const dir of TARGETS) {
    try {
        rmSync(join(ROOT, dir), { recursive: true, force: true });
        console.log(`deleted: ${dir}/`);
    } catch (error) {
        // Kilitli dosyalar normalde `force: true` ile yutulur; buraya düşmek,
        // dosyanın başka bir süreç tarafından işaretlendiği anlamına gelir.
        failures.push({ dir, error });
        console.log(`failed to delete: ${dir}/ — ${error.message}`);
    }
}

if (failures.length > 0) {
    console.log(
        "\nWarning: some leftovers could not be deleted. Windows Defender or a " +
            "running Coderio/Electron process may be holding the files. " +
            "You may need to delete these folders manually or restart the computer.",
    );
    console.log(
        `Remaining targets: ${failures.map((item) => `${item.dir}/`).join(", ")}`,
    );
}
