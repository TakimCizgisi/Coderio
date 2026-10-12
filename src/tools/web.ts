import type { AgentTool } from "../config/types.js";
import { limitOutput } from "./utils.js";

export type WebSearchResult = {
    title: string;
    url: string;
    snippet: string;
};

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (_, code: string) => {
            const cp = Number(code);
            return cp > 0 ? String.fromCodePoint(cp) : "";
        });
}

function stripTags(text: string): string {
    return decodeEntities(text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
}

function decodeRedirectUrl(href: string): string {
    try {
        if (href.startsWith("//")) href = `https:${href}`;
        const u = new URL(href);
        if (u.hostname.includes("duckduckgo.com")) {
            const target = u.searchParams.get("uddg");
            if (target) return decodeURIComponent(target);
        }
        return href;
    } catch {
        return href;
    }
}

function parseResults(html: string, maxResults: number): WebSearchResult[] {
    const results: WebSearchResult[] = [];
    const resultRe =
        /<a[^>]*class="(?:result__a|result-link)"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
    const snippetRe =
        /<a[^>]*class="(?:result__snippet|result-snippet)"[^>]*>(.*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const titles: { href: string; title: string }[] = [];
    while ((match = resultRe.exec(html)) !== null && titles.length < maxResults) {
        titles.push({ href: match[1] ?? "", title: stripTags(match[2] ?? "") });
    }

    if (titles.length === 0) {
        const genericRe = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi;
        while ((match = genericRe.exec(html)) !== null && titles.length < maxResults) {
            const title = stripTags(match[2] ?? "");
            if (!title) continue;
            titles.push({ href: match[1] ?? "", title });
        }
    }

    const snippets: string[] = [];
    while ((match = snippetRe.exec(html)) !== null && snippets.length < titles.length) {
        snippets.push(stripTags(match[1] ?? ""));
    }

    for (let i = 0; i < titles.length; i++) {
        const item = titles[i];
        if (!item || !item.title) continue;
        results.push({
            title: item.title,
            url: decodeRedirectUrl(item.href),
            snippet: snippets[i] ?? ""
        });
    }
    return results;
}

export const webSearchTool: AgentTool = {
    name: "web_search",
    description:
        "Searches the web (DuckDuckGo, no API key required). Use to find current information, news or documentation. " +
        "Returns up to maxResults (default 5, max 10) results: title, snippet and URL.",
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query (English gives better results)" },
            maxResults: { type: "integer", description: "Number of results to return (default: 5, max: 10)" }
        },
        required: ["query"]
    },
    handler: async (params: { query: string; maxResults?: number }, ctx) => {
        const query = params.query.trim();
        if (!query) return { ok: false, output: "Search query cannot be empty." };
        const maxResults = Math.min(Math.max(params.maxResults ?? 5, 1), 10);
        const timeoutMs = ctx.config.toolTimeout ?? 15_000;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let html: string;
        try {
            const res = await fetch(
                `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                    },
                    signal: controller.signal,
                    redirect: "follow"
                }
            );
            if (!res.ok) {
                return { ok: false, output: `Search failed (HTTP ${res.status}): ${res.statusText}` };
            }
            html = await res.text();
        } catch (err) {
            const aborted = controller.signal.aborted;
            return {
                ok: false,
                output: aborted
                    ? `Search timed out (${timeoutMs}ms) or was cancelled.`
                    : `Search error: ${(err as Error).message}`
            };
        } finally {
            clearTimeout(timer);
        }

        const results = parseResults(html, maxResults);
        if (results.length === 0) {
            return { ok: true, output: `No results found for "${query}".` };
        }

        const lines = results.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || "(no snippet)"}`
        );
        return { ok: true, output: limitOutput(lines.join("\n\n"), ctx.config.maxToolOutput) };
    }
};

function htmlToText(html: string): string {
    return stripTags(
        html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, "\n")
    );
}

export const fetchUrlTool: AgentTool = {
    name: "fetch_url",
    description:
        "Downloads a URL's content and returns it as text. HTML pages are converted to plain text. " +
        "Use to read the details of a page found with web_search.",
    parameters: {
        type: "object",
        properties: {
            url: { type: "string", description: "Address to download (http/https)" },
            maxLength: { type: "integer", description: "Maximum characters to return (default 12000, max 40000)" }
        },
        required: ["url"]
    },
    handler: async (params: { url?: string; maxLength?: number }, ctx) => {
        const url = params.url?.trim();
        if (!url || !/^https?:\/\//i.test(url)) {
            return { ok: false, output: "A valid http(s) URL is required." };
        }
        const timeoutMs = ctx.config.toolTimeout ?? 20_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                },
                signal: controller.signal,
                redirect: "follow"
            });
            if (!res.ok) {
                return { ok: false, output: `Download failed (HTTP ${res.status}): ${res.statusText}` };
            }
            const contentType = res.headers.get("content-type") ?? "";
            const body = await res.text();
            const isHtml = contentType.includes("text/html") || /^\s*<(!doctype|html)/i.test(body);
            const text = isHtml ? htmlToText(body) : body;
            const maxLen = Math.min(Math.max(params.maxLength ?? 12_000, 500), 40_000);
            const header = `URL: ${url}\nType: ${contentType || "unknown"}\nLength: ${text.length} characters\n\n`;
            return { ok: true, output: limitOutput(header + text, maxLen + header.length + 100) };
        } catch (err) {
            const aborted = controller.signal.aborted;
            return {
                ok: false,
                output: aborted
                    ? `Timed out (${timeoutMs}ms) or was cancelled.`
                    : `Download error: ${(err as Error).message}`
            };
        } finally {
            clearTimeout(timer);
        }
    }
};
