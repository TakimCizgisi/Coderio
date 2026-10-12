/**
 * `UI/LOGO.svg` -> `build/icon.png` + `build/icon.ico`
 *
 * Electron'u görüntü olarak kullanır: SVG kare bir tuvale ortalanır, pencere
 * `capturePage()` ile PNG'ye çevrilir, gerekli boyutlar `nativeImage.resize`
 * ile türetilir ve sonuç çok boyutlu bir `.ico` olarak paketlenir.
 *
 * Çalıştırma: `npm run icon` (Node değil, Electron gerekir).
 */
const { app, BrowserWindow, nativeImage } = require("electron");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const buildDir = join(root, "build");
const source = join(root, "UI", "LOGO.svg");

/** Uygulamanın koyu tema rengi; ikon zemini bu renkle birebir aynı. */
const BACKGROUND = "#101317";
const CANVAS = 1024;
/** Logo kare içinde ne kadar genişlik kaplasın (kenar boşluğu için 0.82). */
const LOGO_WIDTH_RATIO = 0.82;

/** ICO içine gömülecek boyutlar (küçükten büyüğe). 256 için 0 yazılır. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildHtml(svg) {
    const encoded = Buffer.from(svg, "utf8").toString("base64");
    const width = Math.round(CANVAS * LOGO_WIDTH_RATIO);
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: ${BACKGROUND};
               scrollbar-width: none; overflow: hidden; }
  body { width: ${CANVAS}px; height: ${CANVAS}px; display: flex;
         align-items: center; justify-content: center; overflow: hidden; }
  img { width: ${width}px; height: auto; display: block; }
</style></head>
<body><img src="data:image/svg+xml;base64,${encoded}" alt="Coderio"></body></html>`;
}

/** PNG verilerini çok boyutlu ICO olarak paketler (PNG sıkıştırmalı girişler). */
function packIco(images) {
    const count = images.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(count, 4);

    const directory = Buffer.alloc(16 * count);
    let offset = header.length + directory.length;

    images.forEach((img, index) => {
        const size = img.size;
        const base = index * 16;
        directory.writeUInt8(size >= 256 ? 0 : size, base + 0); // width (0 = 256)
        directory.writeUInt8(size >= 256 ? 0 : size, base + 1); // height
        directory.writeUInt8(0, base + 2); // palette size
        directory.writeUInt8(0, base + 3); // reserved
        directory.writeUInt16LE(1, base + 4); // color planes
        directory.writeUInt16LE(32, base + 6); // bits per pixel
        directory.writeUInt32LE(img.png.length, base + 8);
        directory.writeUInt32LE(offset, base + 12);
        offset += img.png.length;
    });

    return Buffer.concat([header, directory, ...images.map((i) => i.png)]);
}

/**
 * Yakalanan görüntüyü tam kare yapar.
 *
 * `setContentSize` Windows'ta DPI yuvarlaması nedeniyle bir piksel kayabiliyor
 * (1024x1025 gibi). Merkezden kare kırpma, ikonun her zaman tam kare ve
 * bozulmadan ölçeklenmiş olmasını garanti eder.
 */
function squareCenter(img) {
    const size = img.getSize();
    if (size.width === size.height) return img;
    const side = Math.min(size.width, size.height);
    return img.crop({
        x: Math.floor((size.width - side) / 2),
        y: Math.floor((size.height - side) / 2),
        width: side,
        height: side
    });
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: CANVAS,
        height: CANVAS,
        show: false,
        frame: false,
        backgroundColor: BACKGROUND,
        webPreferences: { offscreen: true }
    });
    // Pencere boyutu çerçeveyi de içerdiği için içerik alanı tam kare yapılır;
    // aksi hâlde `capturePage()` 1024x1019 gibi kırpık bir görüntü döner ve
    // `resize` ile küçültülen ikon hafifçe ezilir.
    win.setContentSize(CANVAS, CANVAS);

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(readFileSync(source, "utf8")))}`);
    // SVG'nin yerleşmesi ve ilk boyama tamamlanana kadar bekle.
    await new Promise((resolve) => setTimeout(resolve, 600));

    const captured = squareCenter(await win.webContents.capturePage());
    const { width, height } = captured.getSize();
    if (width !== height) throw new Error(`non-square icon: ${width}x${height}`);
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, "icon.png"), captured.toPNG());

    const images = ICO_SIZES.map((size) => ({
        size,
        png: captured.resize({ width: size, height: size, quality: "best" }).toPNG()
    }));
    writeFileSync(join(buildDir, "icon.ico"), packIco(images));

    console.log(`[icon] wrote build/icon.png (${CANVAS}x${CANVAS}) and build/icon.ico (${ICO_SIZES.join(", ")})`);
    app.quit();
});
