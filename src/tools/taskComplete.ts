import type { AgentTool } from "../config/types.js";

export const taskCompleteTool: AgentTool = {
    name: "task_complete",
    description:
        "Controls the task flow by YOUR own decision. " +
        "If the work isn't finished yet, call with continue:true to proceed to the remaining steps (a new round starts). " +
        "When the task is DONE and verified, call with continue:false (or without continue); " +
        "write a summary of the work done in the report parameter.",
    parameters: {
        type: "object",
        properties: {
            report: { type: "string", description: "Status of the work / short summary of what was completed" },
            continue: {
                type: "boolean",
                description:
                    "true: continue the task, request a new round (at the end of the round the model continues the conversation). " +
                    "false or omitted: finish the task."
            }
        },
        required: []
    },
    handler: async (params: { report?: string; continue?: boolean }, ctx) => {
        if (ctx.signals) {
            if (params.continue === true) {
                ctx.signals.continueRequested = true;
                return { ok: true, output: "Continuation round requested (continue:true). The model will proceed with the remaining steps." };
            }
            ctx.signals.taskCompleted = true;
        }
        const report = (params.report ?? "").trim();
        return { ok: true, output: report || "Task completed." };
    }
};
