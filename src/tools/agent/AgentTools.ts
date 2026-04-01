// SubAgent & LLM Tools
// subagent.spawn – Parallel LLM sessions
// llm.send – Direct LLM calls

import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { Tool } from "../Tool.js";
import type { SubAgentManager } from "../../gateway/SubAgentManager.js";
import type { LLMAdapter } from "../../gateway/LLMAdapter.js";

/** Factory: creates subagent tool */
export function createSubAgentTool(subAgents: SubAgentManager): Tool {
  return buildTool({
    name: "subagent.spawn",
    description: "Sub-Agent für Unteraufgaben starten",
    category: "agents",
    parameterDescription: "{ name, systemPrompt, userPrompt }",
    concurrencySafe: false,

    inputSchema: z.object({
      name: z.string().default("Sub-Agent").describe("Name des Sub-Agents"),
      systemPrompt: z.string().default("Du bist ein hilfreicher Assistent.").describe("System-Prompt"),
      userPrompt: z.string().min(1).describe("Aufgabe für den Sub-Agent"),
    }),

    async call(input) {
      const start = Date.now();
      const result = await subAgents.spawn({
        id: `sub-${Date.now()}`,
        name: input.name,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
      });
      if (!result.success) throw new Error(result.error ?? "Sub-Agent Fehler");
      return {
        data: { response: result.response, costUsd: result.costUsd },
        meta: { durationMs: Date.now() - start, costUsd: result.costUsd },
      };
    },
  });
}

/** Factory: creates LLM tool for direct text generation */
export function createLlmTool(llm: LLMAdapter | null): Tool {
  return buildTool({
    name: "llm.send",
    description: "LLM-Call ausführen (kostet Geld!)",
    category: "llm",
    parameterDescription: "{ userPrompt, systemPrompt? }",
    concurrencySafe: true,
    isEnabled: () => llm !== null,

    inputSchema: z.object({
      userPrompt: z.string().min(1).describe("Prompt an das LLM"),
      systemPrompt: z.string().optional().describe("System-Prompt"),
    }),

    async call(input) {
      const start = Date.now();
      const messages = [{ role: "user" as const, content: input.userPrompt }];
      const response = await llm!.send(messages, input.systemPrompt);
      return {
        data: {
          text: response.text,
          tokensUsed: response.tokensUsed,
          costUsd: response.costUsd,
        },
        meta: {
          durationMs: Date.now() - start,
          tokensUsed: response.tokensUsed.prompt + response.tokensUsed.completion,
          costUsd: response.costUsd,
        },
      };
    },
  });
}
