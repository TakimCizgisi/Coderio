<p align="center">
  <img src="assets/LOGO.svg" alt="Coderio Logo" width="280" />
</p>

<h1 align="center">Coderio</h1>

<p align="center">
  <b>Tamamen yerel çalışan otonom AI kodlama asistanı</b><br />
  TakımÇizgisi LSH Yazılım Geliştirme Grubu ve Topluluğu
</p>

<p align="center">
  <img src="https://img.shields.io/badge/sürüm-0.6.0%20%22Phantom%22-2d74da" alt="Sürüm" />
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-44-47848f?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/motor-node--llama--cpp-C84B31?logo=llama.cpp&logoColor=white" alt="Motor" />
  <img src="https://img.shields.io/badge/dil-TypeScript-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/lisans-LSH--1-8a63d2" alt="Lisans" />
</p>

> Coderio, projenizi tarayan, görevleri planlayan, kodu dosyalara yazan ve sonucu
> doğrulayan bir masaüstü ajanıdır. Model bilgisayarınızda koşar, kaynak kodunuz ve
> sohbetiniz **cihazınızdan çıkmaz**. Bulut bağlantısı gerekmez.

---

## İçindekiler

- [Özellikler](#özellikler)
- [Mimari](#mimari)
- [Gereksinimler](#gereksinimler)
- [Kurulum](#kurulum)
- [Çalıştırma](#çalıştırma)
- [Paketleme](#paketleme)
- [Araçlar (Tool Set)](#araçlar-tool-set)
- [Modeller ve GPU](#modeller-ve-gpu)
- [CLI](#cli)
- [Proje Yapısı](#proje-yapısı)
- [Geliştirme](#geliştirme)
- [Lisans](#lisans)

---

## Özellikler

- **Yerel ve çevrimdışı** — Model indirilir ve `node-llama-cpp` ile yerelde çalışır.
  Kod, ayarlar ve sohbet hiçbir servise gönderilmez.
- **Otonom ajan akışı** — Görevi planlar, araçları çağırır, dosyaları düzenler,
  komut çalıştırır ve işi tamamlandığını bildirene kadar devam eder.
- **Proje bağlamı** — Ajan çalışmaya başlarken dizin ağacını ve ilgili dosyaları
  okuyarak hedef projeye göre davranır.
- **Uzun bağlam** — `gemma4` chat sarmalayıcısı ve uzun bağlam penceresi desteği.
- **Gerçek dosya araçları** — Oku, yaz, düzenle, taşı, sil, patch uygula, dizin
  listele, dosya ara, grep.
- **Komut çalıştırma** — Terminal komutları ajan tarafından çalıştırılır; model
  çıktısı doğrulanır.
- **Web erişimi** — Web araması ve URL çekme araçları (isteğe bağlı).
- **Not hafızası** — Ajan kalıcı notlar tutabilir ve sonradan okuyabilir.
- **Plan panosu** — `todo` listesi araçları ile adımları izleyebilirsiniz.
- **GPU hızlandırma** — CUDA ve Vulkan ile donanım hızlandırma; otomatik seçim.
- **Saf masaüstü** — Çerçevesiz, özel pencere çubuğu, açılış ekranında logo ve
  sohbet, geçmiş ve ayar katmanları.
- **Ayrı CLI** — Ayarları komut satırından yönetmek için hafif bir arayüz.

---

## Mimari

Ajan motoru, Electron ana sürecinden ayrı bir `utilityProcess` alt sürecinde
çalışır. Ana süreç ile motor yalnızca süreç içi `MessagePort` üzerinden haberleşir;
dışarıya açık bir port yoktur.

```
┌─────────────────────────────────────────────┐
│ Electron ana süreç (src/main)               │
│  ├─ pencere yönetimi                        │
│  ├─ IPC yönlendirme                         │
│  └─ motor yaşam döngüsü                     │
└──────────────────┬──────────────────────────┘
                   │ MessagePort (süreç içi)
┌──────────────────▼──────────────────────────┐
│ Motor süreci (src/host)                     │
│  ├─ node-llama-cpp motoru                   │
│  ├─ model indirme / doğrulama               │
│  ├─ agent döngüsü + araçlar (src/core, src/tools)
└──────────────────┬──────────────────────────┘
                   │ preload (src/preload)
┌──────────────────▼──────────────────────────┐
│ Renderer / arayüz (src/renderer)            │
│  ├─ açılış ekranı (logo + prompt)           │
│  ├─ sohbet günlüğü, geçmiş, ayarlar         │
└─────────────────────────────────────────────┘
```

---

## Gereksinimler

- **Windows 10/11 (x64)** — hedef platform Windows.
- **Node.js >= 26.4.0** (`package.json` → `engines`)
- **Git**
- İsteğe bağlı **NVIDIA GPU** (CUDA) veya **Vulkan** destekli ekran kartı.
  GPU yoksa model CPU üzerinde çalışır.

---

## Kurulum

```bash
git clone https://github.com/TakimCizgisi/Coderio.git
cd Coderio
npm install
```

`node-llama-cpp`, `esbuild` ve `electron` kurulum betiklerinin çalışmasına izin
vermelidir (indirilen ikili dosyalar CUDA/Vulkan desteği için gereklidir).

---

## Çalıştırma

```bash
# derle + Electron'u başlat
npm start

# yalnızca derle
npm run build

# derleme izleme (geliştirme)
npm run dev
```

Açılışta model otomatik olarak seçilir; ilk kullanımda model dosyası
`~/.coderio` altına indirilir (GB boyutunda olabilir, internet gerekir —
sonrasında tamamen çevrimdışı çalışır).

---

## Paketleme

```bash
# yalnızca klasöre paketle (hızlı)
npm run pack

# Windows NSIS kurulum sihirbazı: Coderio-<sürüm>-x64-setup.exe
npx electron-builder --win nsis --x64

# Linux (AppImage + deb): Coderio-<sürüm>-x64.AppImage / .deb
npx electron-builder --linux AppImage deb --x64

# ikisi birden
npm run dist
```

Çıktı `release/` altına yazılır.

| Platform | Çıktı |
| --- | --- |
| Windows | `Coderio-<sürüm>-x64-setup.exe` (NSIS kurulum sihirbazı) |
| Linux | `Coderio-<sürüm>-x64.AppImage` ve `Coderio-<sürüm>-x64.deb` |
| macOS | `.app` / `.dmg` — yalnızca macOS üzerinde üretilebilir |

Windows kurulumu `PATH`'e `$INSTDIR` ekler ve `coderio.cmd` kısayolunu oluşturur.
Model dosyaları kullanıcı verisi olduğu için kaldırma işlemi sırasında silinmez
(`deleteAppDataOnUninstall: false`).

> **Not:** Derleme sırasında `node_modules` içinde hedef platformun
> `@node-llama-cpp` ikili dosyası bulunmalıdır (örn. Linux için `linux-x64`).
> `npm install` yalnızca makinenizin platformuna uygun olanı indirir; başka
> platforma derlemeden önce ilgili paketi elle eklemeniz gerekir.

Sürümler doğrudan etiket (tag) ile yayınlanır:

```bash
git tag v0.6.0
git push coderio v0.6.0
```

Ardından [Releases](https://github.com/TakimCizgisi/Coderio/releases/new)
üzerinden sürüm notları girilir ve derleme çıktıları eklenir.

---

## Araçlar (Tool Set)

| Kategori | Araçlar |
| --- | --- |
| Dosya okuma/yazma | `readFile`, `writeFile`, `editFile`, `listDir`, `searchFiles`, `grep` |
| Dosya sistemi | `moveFile`, `deleteFile`, `readData`, `unzipFile` |
| Komut | `runCommand` |
| Yama | `applyPatch` |
| Web | `webSearch`, `fetchUrl` |
| Hafıza | `noteAdd`, `noteRead` |
| Pano | `setTodos`, `getTodos`, `openPlayground` |
| Bitirme | `taskComplete` |

Bir araç hata verirse hata mesajı modele geri döner ve model işlemi
**başarılı olarak raporlamaması** gerektiğini öğrenir; başarısız işlem
sessizce yok sayılmaz.

---

## Modeller ve GPU

Varsayılan model kataloğu `config/models.json` içinde tutulur:

| Model | ID | Not |
| --- | --- | --- |
| Gemma 4 E2B (Q4_K_M) | `gemma-4-e2b-q4-k-m` | 4-bit sıkıştırılmış, ~3-4 GB RAM, reasoning destekli |

Model kataloğu uzak kaynaktan güncellenebilir; arayüzden model indirilebilir ve
bağlam/gpu ayarları model başına değiştirilebilir.

GPU doğrulaması için:

```bash
npm run check:gpu
```

Bu araç iki ayrı soruyu yanıtlar: makine CUDA/Vulkan **destekliyor mu**, motor
**gerçekten GPU'da mı çalışıyor**. GPU arka ucunu `config` içinden `auto`,
`cuda`, `vulkan` arasında seçebilirsiniz.

---

## CLI

Ayarları komut satırından düzenlemek için (motoru başlatmaz, hafif açılış):

```bash
npm run cli
```

CLI yalnızca ayarlar menüsüdür; model motorunu indirmez ve başlatmaz.

---

## Proje Yapısı

```
├── assets/            # README görselleri (logo)
├── build/             # uygulama ikonu, NSIS betiği
├── config/            # model kataloğu (models.json)
├── scripts/           # GPU kontrolü, duman testleri, yardımcılar
├── src/
│   ├── cli/           # komut satarı arayüzü
│   ├── config/        # ayarlar ve model kataloğu yükleyici
│   ├── core/          # ajan döngüsü
│   ├── engine/        # node-llama-cpp motoru + model yöneticisi
│   ├── host/          # motor alt süreci
│   ├── main/          # Electron ana süreci
│   ├── preload/       # güvenli köprü
│   ├── protocol/      # süreçler arası mesaj tipleri
│   ├── renderer/      # arayüz (HTML/CSS/TS)
│   ├── tools/         # ajan araçları
│   └── utils/         # ortak yardımcılar
├── UI/                # tek görsel kaynak (logo, font) → dist/renderer'a kopyalanır
├── esbuild.mjs        # 4 hedefli derleme betiği
└── electron-builder.yml  # paketleme ayarları
```

---

## Geliştirme

```bash
npm run typecheck    # tsc kontrolü (main + renderer)
npm run test:tools   # araç duman testi
npm run test:ipc     # IPC duman testi
npm run check:gpu    # GPU doğrulaması
npm run clean        # dist/ ve out/ temizliği
```

Derleme `esbuild.mjs` üzerinden dört ayrı hedefe yapılır: ana süreç (ESM),
motor (ESM), preload (CJS), renderer (IIFE). Statik dosyalar (HTML, font, logo)
derlemeden kopyalanır.

---

## Lisans

Bu proje **TakımÇizgisi LSH-1** (Limited Source Human License) altındadır.
Ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.

Telif © 2026 TakımÇizgisi LSH Yazılım Geliştirme Grubu ve Topluluğu.

<p align="center">
  <sub>Yerel çalışır · Veri cihazda kalır · TakımÇizgisi ile yapıldı</sub>
</p>
