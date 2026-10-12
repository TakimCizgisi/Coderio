import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { createCoreTools } from "../src/tools/registry.js";
import type { CoderioConfig, ToolExecutionContext } from "../src/config/types.js";

let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

async function main(): Promise<void> {
    const tmp = mkdtempSync(join(os.tmpdir(), "coderio-smoke-"));
    const config: CoderioConfig = {
        modelId: "smoke",
        toolTimeout: 2_000,
        maxToolOutput: 10_000
    };
    const ctx: ToolExecutionContext = { cwd: tmp, config };
    const tools = new Map(createCoreTools(ctx).map((t) => [t.name, t]));
    const run = (name: string, params: Record<string, unknown>): Promise<{ ok: boolean; output: string }> => {
        const tool = tools.get(name);
        if (!tool) throw new Error(`Tool not found: ${name}`);
        return Promise.resolve(tool.handler(params, ctx));
    };

    console.log("Tool smoke test");
    console.log(`Temp dir: ${tmp}\n`);

    try {
        // write_file + read_file
        let res = await run("write_file", { path: "src/hello.txt", content: "first line\nsecond line" });
        check("write_file creates", res.ok && existsSync(join(tmp, "src", "hello.txt")), res.output);

        res = await run("write_file", { path: "src/hello.txt", content: "\nthird line", append: true });
        check("write_file append", res.ok, res.output);

        res = await run("read_file", { path: "src/hello.txt" });
        check("read_file content", res.ok && res.output.includes("first line") && res.output.includes("third line"), res.output);

        // list_dir
        res = await run("list_dir", { path: ".", recursive: true });
        check("list_dir recursive", res.ok && res.output.includes("hello.txt"), res.output);

        // search_files
        res = await run("search_files", { pattern: "**/*.txt" });
        check("search_files glob", res.ok && res.output.includes("hello.txt"), res.output);

        // grep_files
        res = await run("grep_files", { pattern: "third" });
        check("grep_files finds", res.ok && res.output.includes("third"), res.output);

        res = await run("grep_files", { pattern: "[" });
        check("grep_files invalid regex error", !res.ok && res.output.includes("Invalid regex"), res.output);

        // apply_patch
        const patch = [
            "--- a/src/hello.txt",
            "+++ b/src/hello.txt",
            "@@ -1,2 +1,3 @@",
            " first line",
            "-second line",
            "+new line",
            "+third line"
        ].join("\n");
        res = await run("apply_patch", { patch });
        check("apply_patch applies", res.ok, res.output);
        const patched = readFileSync(join(tmp, "src", "hello.txt"), "utf8");
        check("apply_patch content", patched.includes("new line") && !patched.includes("second line"), patched);

        // edit_file
        res = await run("edit_file", { path: "src/hello.txt", oldString: "new line", newString: "edited line" });
        check("edit_file changes", res.ok, res.output);
        let edited = readFileSync(join(tmp, "src", "hello.txt"), "utf8");
        check("edit_file content", edited.includes("edited line") && !edited.includes("new line"), edited);

        res = await run("edit_file", { path: "src/hello.txt", oldString: "no such text", newString: "x" });
        check("edit_file no match error", !res.ok && res.output.includes("No match found"), res.output);

        res = await run("edit_file", { path: "src/hello.txt", oldString: "line", newString: "X", replaceAll: false });
        check("edit_file multiple match error", !res.ok && res.output.includes("appears"), res.output);

        res = await run("edit_file", { path: "src/hello.txt", oldString: "line", newString: "line", replaceAll: true });
        check("edit_file replaceAll", res.ok, res.output);

        // run_command: dangerous command is blocked
        res = await run("run_command", { command: "format c:" });
        check("run_command blocks dangerous command", !res.ok && res.output.includes("Command blocked"), res.output);

        // run_command: success
        const echoCmd = process.platform === "win32" ? "echo smoke-test-ok" : "echo smoke-test-ok";
        res = await run("run_command", { command: echoCmd });
        check("run_command succeeds", res.ok && res.output.includes("smoke-test-ok"), res.output);

        // run_command: relative cwd resolves against ctx.cwd
        res = await run("run_command", { command: echoCmd, cwd: "src" });
        check("run_command relative cwd", res.ok, res.output);

        // run_command: timeout + process tree kill (Windows: taskkill)
        const sleepCmd = process.platform === "win32"
            ? "ping -n 30 127.0.0.1 >nul"
            : "sleep 30";
        const started = Date.now();
        res = await run("run_command", { command: sleepCmd, timeout: 1500 });
        const elapsed = Date.now() - started;
        check(
            "run_command returns on timeout (does not hang)",
            !res.ok && res.output.includes("[TIMEOUT") && elapsed < 20_000,
            `${res.output} (${elapsed}ms)`
        );
        // On Windows, releasing process-tree handles takes a moment;
        // take a short breath before cleanup.
        await new Promise((r) => setTimeout(r, 1500));

        // web_search: try if network is available, otherwise warn
        res = await run("web_search", { query: "opencode test", maxResults: 3 });
        if (res.ok) {
            check("web_search result", res.output.includes("http"), res.output.slice(0, 200));
        } else {
            console.log(`  ---- web_search skipped (network may be unavailable): ${res.output.slice(0, 120)}`);
        }

        // task_complete: marks the signal
        const signals = { taskCompleted: false };
        const ctxWithSignals: ToolExecutionContext = { ...ctx, signals };
        const completeTool = tools.get("task_complete");
        if (!completeTool) throw new Error("Tool not found: task_complete");
        res = await Promise.resolve(completeTool.handler({ report: "done" }, ctxWithSignals));
        check("task_complete signal", res.ok && signals.taskCompleted === true, res.output);

        // not_al / not_oku
        res = await run("not_al", { text: "smoke-test memory note" });
        check("not_al saves", res.ok && res.output.includes("#"), res.output);
        res = await run("not_oku", { query: "smoke-test" });
        check("not_oku finds", res.ok && res.output.includes("memory note"), res.output);

        // move_file + delete_file
        res = await run("move_file", { source: "src/hello.txt", destination: "moved/moved.txt" });
        check("move_file moves", res.ok && existsSync(join(tmp, "moved", "moved.txt")), res.output);
        res = await run("delete_file", { path: "moved/moved.txt" });
        check("delete_file deletes", res.ok && !existsSync(join(tmp, "moved", "moved.txt")), res.output);
        res = await run("delete_file", { path: "." , recursive: true });
        check("delete_file cwd protection", !res.ok && res.output.includes("cannot delete"), res.output);

        // read_data: JSON and YAML
        writeFileSync(join(tmp, "data.json"), JSON.stringify({ name: "coderio", count: 7, list: [1, 2, 3] }), "utf8");
        res = await run("read_data", { path: "data.json" });
        check("read_data json", res.ok && res.output.includes("coderio") && res.output.includes("object"), res.output);
        writeFileSync(join(tmp, "data.yaml"), "name: coderio\ncount: 7\n", "utf8");
        res = await run("read_data", { path: "data.yaml" });
        check("read_data yaml", res.ok && res.output.includes("coderio"), res.output);

        // unzip_file
        const zipPath = join(tmp, "archive.zip");
        const AdmZipMod = await import("adm-zip");
        const zip = new AdmZipMod.default();
        zip.addFile("inside/readme.txt", Buffer.from("zip smoke content", "utf8"));
        zip.writeZip(zipPath);
        res = await run("unzip_file", { path: "archive.zip" });
        check(
            "unzip_file extracts",
            res.ok && existsSync(join(tmp, "inside", "readme.txt")) && readFileSync(join(tmp, "inside", "readme.txt"), "utf8").includes("smoke"),
            res.output
        );

        // fetch_url: try if network is available
        res = await run("fetch_url", { url: "https://example.com", maxLength: 2000 });
        if (res.ok) {
            check("fetch_url content", res.output.includes("example"), res.output.slice(0, 160));
        } else {
            console.log(`  ---- fetch_url skipped (network may be unavailable): ${res.output.slice(0, 120)}`);
        }
    } finally {
        // On Windows, force:true can silently leave leftovers instead of throwing,
        // so retry in a loop until the directory is really gone.
        // (Waits for the cmd.exe cwd handle from the timeout test to be released.)
        for (let attempt = 0; attempt < 15 && existsSync(tmp); attempt++) {
            try {
                rmSync(tmp, { recursive: true, force: true });
            } catch {
                /* locked: wait and retry */
            }
            if (!existsSync(tmp)) break;
            await new Promise((r) => setTimeout(r, 500));
        }
    }

    console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TESTS FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
