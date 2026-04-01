// ToolRegistry – Central tool collection, discovery, and execution
// Inspired by Claude Code's tools.ts pattern: register → filter → execute

import type { z } from "zod";
import type {
  Tool, ToolCall, ToolCallResult, ToolContext,
  ToolCategory, PermissionMode,
} from "./Tool.js";
import type { GatewayLogger } from "../gateway/GatewayLogger.js";

// ═══════════════════════════════════════════════════════════════
//  REGISTRY
// ═══════════════════════════════════════════════════════════════

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private executionCount = 0;

  constructor(private log: GatewayLogger) {}

  /** Register a single tool */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      this.log.gateway(`⚠️ Tool '${tool.name}' already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Register multiple tools at once */
  registerAll(tools: readonly Tool[] | Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** Get a tool by name */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tools */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** Get only enabled tools */
  getEnabled(): Tool[] {
    return this.getAll().filter(t => t.isEnabled());
  }

  /** Get tools filtered by category */
  getByCategory(category: ToolCategory): Tool[] {
    return this.getEnabled().filter(t => t.category === category);
  }

  /** Get read-only tools (safe for parallel execution) */
  getReadOnly(): Tool[] {
    return this.getEnabled().filter(t => t.isReadOnly());
  }

  /** Get concurrency-safe tools */
  getConcurrencySafe(): Tool[] {
    return this.getEnabled().filter(t => t.isConcurrencySafe());
  }

  /** Number of registered tools */
  get size(): number {
    return this.tools.size;
  }

  /** Total executions since startup */
  get totalExecutions(): number {
    return this.executionCount;
  }

  // ═══════════════════════════════════════════════════════════════
  //  SYSTEM PROMPT GENERATION
  // ═══════════════════════════════════════════════════════════════

  /** Generate tool descriptions for the LLM system prompt */
  generateSystemPrompt(): string {
    const enabled = this.getEnabled();
    if (enabled.length === 0) return "";

    const lines: string[] = [
      "## Verfügbare Tools",
      "",
      "Du kannst Tools aufrufen indem du JSON-Blöcke in deine Antwort einfügst:",
      '```json',
      '{ "action": "tool", "id": "<unique-id>", "tool": "<tool-name>", "params": { ... } }',
      '```',
      "",
      "Jeder Tool-Aufruf braucht eine eindeutige `id` (z.B. 'call-1', 'call-2').",
      "Du kannst mehrere Tools in einer Antwort aufrufen.",
      "",
    ];

    // Group by category
    const groups = new Map<ToolCategory, Tool[]>();
    for (const tool of enabled) {
      const existing = groups.get(tool.category) ?? [];
      existing.push(tool);
      groups.set(tool.category, existing);
    }

    const categoryNames: Record<ToolCategory, string> = {
      filesystem: "📝 Dateisystem",
      communication: "📱 Kommunikation",
      google_workspace: "📧 Google Workspace (gog CLI)",
      browser: "🌐 Web Browser",
      learning: "🧠 Lernsystem",
      skills: "🧩 OpenClaw Skills",
      agents: "🤖 Sub-Agents & LLM",
      scheduling: "⏰ Cron-Scheduler",
      payments: "💳 Stripe Zahlungen",
      llm: "🤖 Sub-Agents & LLM",
    };

    for (const [category, tools] of groups) {
      lines.push(`### ${categoryNames[category] ?? category}`);
      for (const tool of tools) {
        const flags: string[] = [];
        if (tool.isReadOnly()) flags.push("🔍");
        if (tool.isDestructive()) flags.push("⚠️");
        lines.push(`- \`${tool.name}\` ${tool.parameterDescription} – ${tool.description} ${flags.join(" ")}`);
      }
      lines.push("");
    }

    lines.push(
      "### Regeln",
      "1. Kostenlose Tools zuerst (fs, learning) vor bezahlten (llm, gog).",
      "2. Read-only Tools (🔍) sind sicher für parallele Ausführung.",
      "3. Destruktive Tools (⚠️) benötigen besondere Sorgfalt.",
      "4. Jeder LLM/Sub-Agent-Call kostet Geld – effizient nutzen.",
      "5. Fehler werden automatisch geloggt. Aus Fehlern lernen!",
    );

    return lines.join("\n");
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXECUTION ENGINE
  // ═══════════════════════════════════════════════════════════════

  /** Execute a single tool call with full validation + permission pipeline */
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolCallResult> {
    const start = Date.now();
    this.executionCount++;

    const tool = this.tools.get(call.tool);
    if (!tool) {
      return this.failResult(call, `Unbekanntes Tool: ${call.tool}`, start);
    }

    if (!tool.isEnabled()) {
      return this.failResult(call, `Tool deaktiviert: ${call.tool}`, start);
    }

    try {
      // Phase 1: Schema validation (Zod)
      const parseResult = tool.inputSchema.safeParse(call.params);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
        return this.failResult(call, `Ungültige Parameter: ${errors}`, start);
      }
      const validatedInput = parseResult.data;

      // Phase 2: Custom validation (beyond schema)
      const validation = await tool.validateInput(validatedInput, ctx);
      if (!validation.valid) {
        return this.failResult(call, validation.error, start);
      }

      // Phase 3: Permission check
      const permission = await tool.checkPermissions(validatedInput, ctx);
      if (permission.behavior === "deny") {
        return this.failResult(call, `Keine Berechtigung: ${permission.reason}`, start);
      }
      if (permission.behavior === "confirm") {
        // In autonomous mode, auto-approve most things
        // In manual mode, this would trigger operator confirmation
        if (ctx.permissionMode === "manual") {
          return this.failResult(call, `Bestätigung erforderlich: ${permission.message}`, start);
        }
        // autonomous/default: log and proceed
        this.log.exec(`⚠️ Auto-approved: ${permission.message}`);
      }

      // Phase 4: Execute
      this.log.exec(`🔧 ${call.tool} ${JSON.stringify(call.params).substring(0, 120)}`);

      if (ctx.onProgress) {
        ctx.onProgress({ type: "status", message: `Executing ${call.tool}...` });
      }

      const result = await tool.call(validatedInput, ctx);

      // Phase 5: Format result
      const output = typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data, null, 2);

      // Truncate large outputs (like Claude Code's maxResultSizeChars)
      const maxChars = 50_000;
      const truncated = output.length > maxChars
        ? output.substring(0, maxChars) + `\n\n[...gekürzt: ${output.length} → ${maxChars} Zeichen]`
        : output;

      this.log.ok(`✅ ${call.tool} (${Date.now() - start}ms)`);

      return {
        toolCallId: call.id,
        tool: call.tool,
        success: true,
        output: truncated,
        meta: {
          durationMs: Date.now() - start,
          tokensUsed: result.meta?.tokensUsed,
          costUsd: result.meta?.costUsd,
        },
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`❌ ${call.tool}: ${errMsg}`);
      return this.failResult(call, errMsg, start);
    }
  }

  /** Execute multiple tool calls, respecting concurrency safety */
  async executeAll(calls: ToolCall[], ctx: ToolContext): Promise<ToolCallResult[]> {
    if (calls.length === 0) return [];
    if (calls.length === 1) return [await this.execute(calls[0], ctx)];

    // Separate into concurrent-safe and sequential
    const concurrent: ToolCall[] = [];
    const sequential: ToolCall[] = [];

    for (const call of calls) {
      const tool = this.tools.get(call.tool);
      if (tool?.isConcurrencySafe()) {
        concurrent.push(call);
      } else {
        sequential.push(call);
      }
    }

    const results: ToolCallResult[] = [];

    // Run concurrent tools in parallel
    if (concurrent.length > 0) {
      const parallelResults = await Promise.all(
        concurrent.map(call => this.execute(call, ctx)),
      );
      results.push(...parallelResults);
    }

    // Run sequential tools one by one
    for (const call of sequential) {
      results.push(await this.execute(call, ctx));
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  //  TOOL CALL PARSING (from LLM output)
  // ═══════════════════════════════════════════════════════════════

  /** Parse tool calls from LLM response text.
   *
   * Supports multiple formats:
   * 1. Fenced code blocks: ```json { "action": "tool", ... } ```
   * 2. Inline JSON objects: { "action": "tool", ... }
   * 3. Nested JSON with balanced braces
   */
  parseToolCalls(text: string): ToolCall[] {
    const calls: ToolCall[] = [];
    let callCounter = 0;

    // Strategy 1: Extract from fenced code blocks first (most reliable)
    const fencedPattern = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
    let fencedMatch: RegExpExecArray | null;
    while ((fencedMatch = fencedPattern.exec(text)) !== null) {
      const parsed = this.tryParseToolCall(fencedMatch[1]);
      if (parsed) {
        calls.push({
          id: parsed.id ?? `tc-${++callCounter}-${Date.now()}`,
          tool: parsed.tool,
          params: parsed.params ?? {},
        });
      }
    }

    // Strategy 2: Balanced-brace extraction for inline JSON
    const remaining = text.replace(fencedPattern, ""); // avoid double-parsing fenced blocks
    const extracted = this.extractJsonObjects(remaining);
    for (const jsonStr of extracted) {
      const parsed = this.tryParseToolCall(jsonStr);
      if (parsed) {
        // Deduplicate by id
        const isDuplicate = calls.some(c => c.id === parsed.id);
        if (!isDuplicate) {
          calls.push({
            id: parsed.id ?? `tc-${++callCounter}-${Date.now()}`,
            tool: parsed.tool,
            params: parsed.params ?? {},
          });
        }
      }
    }

    return calls;
  }

  /** Try to parse a JSON string as a tool call. Returns null if not a valid tool call. */
  private tryParseToolCall(jsonStr: string): { id?: string; tool: string; params?: Record<string, unknown> } | null {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === "object" && parsed.action === "tool" && typeof parsed.tool === "string") {
        return parsed as { id?: string; tool: string; params?: Record<string, unknown> };
      }
    } catch {
      // Not valid JSON
    }
    return null;
  }

  /** Extract top-level JSON objects from text using balanced brace counting.
   * More robust than regex for nested objects with params containing braces. */
  private extractJsonObjects(text: string): string[] {
    const results: string[] = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          const candidate = text.substring(start, i + 1);
          // Quick check: only consider if it might be a tool call
          if (candidate.includes('"action"') && candidate.includes('"tool"')) {
            results.push(candidate);
          }
          start = -1;
        }
        if (depth < 0) depth = 0;
      }
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════

  private failResult(call: ToolCall, error: string, startTime: number): ToolCallResult {
    return {
      toolCallId: call.id,
      tool: call.tool,
      success: false,
      output: "",
      error,
      meta: { durationMs: Date.now() - startTime },
    };
  }
}
