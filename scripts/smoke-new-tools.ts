import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCoreTools } from "../src/tools/registry.js";
import { openPlaygroundTool, setTodosTool, getTodosTool } from "../src/tools/playground.js";
import { taskCompleteTool } from "../src/tools/taskComplete.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: string): void => {
    if (ok) console.log(`  ok   ${name}`);
    else { failures++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

const tmp = mkdtempSync(join(tmpdir(), "coderio-test-"));
const ctx = { cwd: tmp, config: { modelId: "x", maxToolOutput: 100000 } };

const tools = createCoreTools(ctx);
const names = tools.map(t => t.name);

check("core tools preserved", tools.length >= 18, `total ${tools.length}`);
for (const need of [
    "open_playground", "set_todos", "get_todos"
]) {
    check(`tool ${need}`, names.includes(need));
}
check("GUI automation tools removed",
    !["screen_info", "screenshot", "mouse_move", "mouse_click", "mouse_scroll", "key_press", "type_text"].some(n => names.includes(n)),
    names.filter(n => n.includes("screen") || n.includes("mouse") || n.includes("key_") || n.includes("type")).join(","));

const opened = await openPlaygroundTool.handler({}, ctx);
check("open_playground creates", opened.ok && opened.output.includes(".coderio"), opened.output);

const played = await openPlaygroundTool.handler({ note: "trial" }, ctx);
check("open_playground keeps contents", played.ok && played.output.includes("0 items"), played.output);

const set = await setTodosTool.handler(
    { todos: [{ text: "step 1" }, { text: "step 2", done: true }] },
    ctx
);
check("set_todos saves", set.ok && set.output.includes("2 items"), set.output);

const get = await getTodosTool.handler({}, ctx);
check("get_todos reads", get.ok && get.output.includes("step 1") && get.output.includes("[x] 2."), get.output);

const reset = await openPlaygroundTool.handler({ reset: true }, ctx);
check("open_playground reset clears", reset.ok && reset.output.includes("1 removed"), reset.output);

const get2 = await getTodosTool.handler({}, ctx);
check("TODO empty after reset", get2.ok && get2.output.includes("No saved TODOs"), get2.output);

const sigA: { taskCompleted?: boolean; continueRequested?: boolean } = {};
const resA = await taskCompleteTool.handler({ report: "mid report", continue: true }, { cwd: tmp, config: { modelId: "smoke" }, signals: sigA });
check("task_complete continue:true requests round", resA.ok && sigA.continueRequested === true && !sigA.taskCompleted, resA.output);

const sigB: { taskCompleted?: boolean; continueRequested?: boolean } = {};
const resB = await taskCompleteTool.handler({ report: "finished", continue: false }, { cwd: tmp, config: { modelId: "smoke" }, signals: sigB });
check("task_complete continue:false finishes", resB.ok && sigB.taskCompleted === true && !sigB.continueRequested, resB.output);

const sigC: { taskCompleted?: boolean; continueRequested?: boolean } = {};
const resC = await taskCompleteTool.handler({ report: "finished" }, { cwd: tmp, config: { modelId: "smoke" }, signals: sigC });
check("task_complete default finishes", resC.ok && sigC.taskCompleted === true && !sigC.continueRequested, resC.output);

const sigD: { taskCompleted?: boolean; continueRequested?: boolean } = {};
const resD = await taskCompleteTool.handler({ report: "finished" }, { cwd: tmp, config: { modelId: "smoke" }, signals: sigD });
check("task_complete report preserved", resD.ok && resD.output.includes("finished"), resD.output);

// Clean up the temp dir (a few retries for Windows locks).
for (let attempt = 0; attempt < 10 && existsSync(tmp); attempt++) {
    try {
        rmSync(tmp, { recursive: true, force: true });
    } catch {
        /* locked: wait and retry */
    }
    if (!existsSync(tmp)) break;
    await new Promise((r) => setTimeout(r, 400));
}

console.log(failures === 0 ? "\nNEW TOOL TESTS PASSED" : `\n${failures} TESTS FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
