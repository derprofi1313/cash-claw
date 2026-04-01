// Learning Tools – learning.log, learning.recall, learning.logError, learning.logFeature, learning.promote
// Self-improving agent knowledge system

import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { Tool } from "../Tool.js";
import type { LearningSystem } from "../../gateway/LearningSystem.js";

/** Factory: creates learning tools bound to a LearningSystem instance */
export function createLearningTools(learning: LearningSystem): Tool[] {
  return [
    buildTool({
      name: "learning.log",
      description: "Erkenntnis speichern",
      category: "learning",
      parameterDescription: "{ category, content }",
      readOnly: false,
      concurrencySafe: true,
      inputSchema: z.object({
        category: z.string().default("general").describe("Kategorie (z.B. 'email', 'seo', 'tools')"),
        content: z.string().min(1).describe("Erkenntnis-Text"),
      }),
      async call(input) {
        const start = Date.now();
        const id = learning.logLearning(input.category, input.content);
        return { data: { id }, meta: { durationMs: Date.now() - start } };
      },
    }),

    buildTool({
      name: "learning.recall",
      description: "Relevante Learnings abrufen",
      category: "learning",
      parameterDescription: "{ context }",
      readOnly: true,
      concurrencySafe: true,
      inputSchema: z.object({
        context: z.string().min(1).describe("Kontext für die Suche"),
      }),
      async call(input) {
        const start = Date.now();
        const learnings = learning.recallLearnings(input.context);
        return { data: learnings, meta: { durationMs: Date.now() - start } };
      },
    }),

    buildTool({
      name: "learning.logError",
      description: "Fehler dokumentieren",
      category: "learning",
      parameterDescription: "{ context, error, solution? }",
      readOnly: false,
      concurrencySafe: true,
      inputSchema: z.object({
        context: z.string().describe("Kontext des Fehlers"),
        error: z.string().describe("Fehlerbeschreibung"),
        solution: z.string().optional().describe("Lösungsvorschlag"),
      }),
      async call(input) {
        const start = Date.now();
        const id = learning.logError(input.context, input.error, input.solution);
        return { data: { id }, meta: { durationMs: Date.now() - start } };
      },
    }),

    buildTool({
      name: "learning.logFeature",
      description: "Feature-Wunsch notieren",
      category: "learning",
      parameterDescription: "{ description, reason }",
      readOnly: false,
      concurrencySafe: true,
      inputSchema: z.object({
        description: z.string().describe("Feature-Beschreibung"),
        reason: z.string().describe("Begründung"),
      }),
      async call(input) {
        const start = Date.now();
        const id = learning.logFeature(input.description, input.reason);
        return { data: { id }, meta: { durationMs: Date.now() - start } };
      },
    }),

    buildTool({
      name: "learning.promote",
      description: "Learning nach SOUL.md/TOOLS.md promoten",
      category: "learning",
      parameterDescription: "{ learningId, targetFile? }",
      readOnly: false,
      concurrencySafe: false,
      inputSchema: z.object({
        learningId: z.string().describe("Learning-ID (z.B. 'LRN-001')"),
        targetFile: z.enum(["SOUL", "TOOLS"]).default("SOUL").describe("Ziel-Bootstrap-Datei"),
      }),
      async call(input) {
        const start = Date.now();
        const result = learning.promoteLearning(input.learningId, input.targetFile);
        if (!result.success) throw new Error(result.message);
        return { data: result.message, meta: { durationMs: Date.now() - start } };
      },
    }),
  ];
}
