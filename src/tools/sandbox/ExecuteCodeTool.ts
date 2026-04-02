// ExecuteCodeTool – Safe code execution inside Docker sandbox
// Supports JavaScript/Node.js, Python, and Bash

import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { SandboxManager } from "../../gateway/SandboxManager.js";

const SUPPORTED_LANGUAGES = ["javascript", "python", "bash"] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

/** Factory: creates sandbox execution tools bound to a SandboxManager instance */
export function createSandboxTools(sandboxManager: SandboxManager | null) {
  const isAvailable = () => sandboxManager !== null && sandboxManager.isEnabled();

  const ExecuteCodeTool = buildTool({
    name: "execute_code",
    description: "Executes code safely in a Docker sandbox (JavaScript, Python, or Bash)",
    category: "filesystem",
    parameterDescription: "{ code, language, timeoutMs? } – Code-String, Sprache, optionaler Timeout",
    readOnly: false,
    destructive: false,
    concurrencySafe: false,
    isEnabled: isAvailable,

    inputSchema: z.object({
      code: z.string().min(1).describe("Der auszuführende Code"),
      language: z.enum(SUPPORTED_LANGUAGES).describe("Programmiersprache: javascript, python, oder bash"),
      timeoutMs: z.number().int().min(1000).max(300_000).optional()
        .describe("Timeout in Millisekunden (1s–300s, default: 30s)"),
    }),

    async call(input) {
      const start = Date.now();
      const result = await sandboxManager!.executeInSandbox(
        input.code,
        input.language,
        input.timeoutMs ? { timeoutMs: input.timeoutMs } : undefined,
      );

      const output = [
        `Exit Code: ${result.exitCode}`,
        result.timedOut ? "⚠ TIMEOUT – Container wurde nach Ablauf der Frist beendet" : null,
        result.stdout ? `stdout:\n${result.stdout.substring(0, 4000)}` : null,
        result.stderr ? `stderr:\n${result.stderr.substring(0, 2000)}` : null,
        `Dauer: ${result.durationMs}ms`,
      ].filter(Boolean).join("\n\n");

      return {
        data: output,
        meta: { durationMs: Date.now() - start },
      };
    },
  });

  return [ExecuteCodeTool] as const;
}
