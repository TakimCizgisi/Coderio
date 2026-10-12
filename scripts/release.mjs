/**
 * GitHub Releases yükleme betiği (Coderio).
 *
 * PowerShell'in UTF-8 / JSON yorumlaması GitHub API ile uyuşmadığı için
 * istekler burada `fetch` ile atılır. Kimlik bilgisi `git credential fill`
 * ile alınır; token hiçbir yere yazılmaz.
 *
 *   node scripts/release.mjs create          # release oluştur
 *   node scripts/release.mjs upload <yol>    # tek dosya yükle
 *   node scripts/release.mjs list            # mevcut asset listesi
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { basename } from "node:path";

const OWNER = "TakimCizgisi";
const REPO = "Coderio";
const TAG = "v0.6.0";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const NOTES = "C:/Users/İBRAHİM/.local/share/opencode/temp/coderio-v0.6.0-release-notes.md";

function token() {
    const out = execSync("git credential fill", {
        input: "protocol=https\nhost=github.com\n\n",
        encoding: "utf8"
    });
    const line = out.split(/\r?\n/).find((l) => l.startsWith("password="));
    if (!line) throw new Error("GitHub kimlik bilgisi bulunamadı");
    return line.slice("password=".length);
}

const TOK = token();
const HEAD = {
    Authorization: `Bearer ${TOK}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "coderio-release",
    "X-GitHub-Api-Version": "2022-11-28"
};

async function api(url, init = {}) {
    const res = await fetch(url, { ...init, headers: { ...HEAD, ...(init.headers || {}) } });
    const text = await res.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }
    return { ok: res.ok, status: res.status, body };
}

/** Büyük dosyalar için GitHub'ın resumable upload uç noktası kullanılır. */
async function upload(id, file, name) {
    const size = statSync(file).size;
    const buf = readFileSync(file);
    const target = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${id}/assets?name=${encodeURIComponent(name)}`;
    const res = await fetch(target, {
        method: "POST",
        headers: { ...HEAD, "Content-Type": "application/octet-stream", "Content-Length": String(size) },
        body: buf
    });
    const text = await res.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }
    return { ok: res.ok, status: res.status, body };
}

const [, , cmd, arg] = process.argv;

if (cmd === "create") {
    const notes = existsSync(NOTES) ? readFileSync(NOTES, "utf8") : "Coderio 0.6.0";
    const r = await api(API + "/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            tag_name: TAG,
            name: 'Coderio 0.6.0 "Phantom"',
            body: notes,
            draft: false,
            prerelease: false,
            target_commitish: "main"
        })
    });
    console.log(JSON.stringify(r, null, 2));
} else if (cmd === "upload") {
    const id = Number(arg);
    if (!Number.isFinite(id)) throw new Error("release ID gerekli: upload <id> <dosya...>");
    const files = process.argv.slice(4);
    if (files.length === 0) throw new Error("yüklenecek dosya yok");
    for (const f of files) {
        const name = basename(f);
        process.stdout.write(`${name} (${(statSync(f).size / 1048576).toFixed(1)} MB) ... `);
        const r = await upload(id, f, name);
        console.log(r.ok ? `OK (${r.body.size} bayt)` : `HATA ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    }
} else if (cmd === "list") {
    const r = await api(`${API}/releases`);
    for (const rel of Array.isArray(r.body) ? r.body : []) {
        console.log(`#${rel.id} ${rel.tag_name} ${rel.name}`);
        for (const a of rel.assets) console.log(`   - ${a.name} (${a.size} bayt) ${a.browser_download_url}`);
    }
} else {
    console.log("kullanım: create | upload <releaseId> <dosya...> | list");
}
