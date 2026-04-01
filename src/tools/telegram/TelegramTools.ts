// Telegram Tools – telegram.send, telegram.sendButtons, telegram.sendFile
// Communication tools for operator interaction

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { ToolContext, ValidationResult } from "../Tool.js";
import type { TelegramAdapter } from "../../gateway/TelegramAdapter.js";

/** Factory: creates telegram tools bound to a TelegramAdapter instance */
export function createTelegramTools(telegram: TelegramAdapter | null) {
  const isAvailable = () => telegram !== null;

  const TelegramSendTool = buildTool({
    name: "telegram.send",
    description: "Nachricht an Operator senden",
    category: "communication",
    parameterDescription: "{ text } – Nachrichtentext (Markdown)",
    readOnly: false,
    concurrencySafe: true,
    isEnabled: isAvailable,

    inputSchema: z.object({
      text: z.string().min(1).describe("Nachrichtentext"),
    }),

    async call(input) {
      const start = Date.now();
      await telegram!.sendToOperator(input.text);
      return {
        data: "Nachricht gesendet",
        meta: { durationMs: Date.now() - start },
      };
    },
  });

  const TelegramSendButtonsTool = buildTool({
    name: "telegram.sendButtons",
    description: "Nachricht mit Inline-Buttons senden",
    category: "communication",
    parameterDescription: "{ text, buttons: [{ text, callback_data?, url? }] }",
    readOnly: false,
    concurrencySafe: true,
    isEnabled: isAvailable,

    inputSchema: z.object({
      text: z.string().min(1).describe("Nachrichtentext"),
      buttons: z.array(z.object({
        text: z.string().describe("Button-Label"),
        callback_data: z.string().optional().describe("Callback-Daten"),
        url: z.string().url().optional().describe("URL-Link"),
      })).min(1).describe("Liste der Buttons"),
    }),

    async call(input) {
      const start = Date.now();
      await telegram!.sendButtons(input.text, input.buttons);
      return {
        data: "Nachricht mit Buttons gesendet",
        meta: { durationMs: Date.now() - start },
      };
    },
  });

  const TelegramSendFileTool = buildTool({
    name: "telegram.sendFile",
    description: "Datei an Operator senden",
    category: "communication",
    parameterDescription: "{ filePath, caption? }",
    readOnly: false,
    concurrencySafe: true,
    isEnabled: isAvailable,

    inputSchema: z.object({
      filePath: z.string().describe("Pfad zur Datei"),
      caption: z.string().optional().describe("Bildunterschrift"),
    }),

    validateInput(input, ctx): ValidationResult {
      // Ensure file is within workspace
      const resolved = path.resolve(ctx.workspaceDir, input.filePath.replace(/^~\/\.cashclaw\//, ""));
      if (!resolved.startsWith(ctx.workspaceDir)) {
        return { valid: false, error: "Dateipfad außerhalb des Workspace" };
      }
      if (!fs.existsSync(resolved)) {
        return { valid: false, error: `Datei nicht gefunden: ${input.filePath}` };
      }
      return { valid: true };
    },

    async call(input, ctx) {
      const start = Date.now();
      const resolved = path.resolve(ctx.workspaceDir, input.filePath.replace(/^~\/\.cashclaw\//, ""));
      await telegram!.sendFile(resolved, input.caption);
      return {
        data: `Datei gesendet: ${path.basename(resolved)}`,
        meta: { durationMs: Date.now() - start },
      };
    },
  });

  return [TelegramSendTool, TelegramSendButtonsTool, TelegramSendFileTool] as const;
}
