// QueryLoop – Multi-turn LLM ↔ Tool conversation loop
// Inspired by Claude Code's query.ts: Stream → Parse → Execute Tools → Feed Back → Loop
// The core improvement over the old single-shot execute approach

import type { GatewayLogger } from "./GatewayLogger.js";
import type { LLMAdapter } from "./LLMAdapter.js";
import type { CostTracker } from "./CostTracker.js";
import type { SessionManager } from "./SessionManager.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { ToolContext, ToolCall, ToolCallResult, ConversationMessage } from "../tools/Tool.js";

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

export interface QueryConfig {
  /** Max tool-use turns per query (prevents infinite loops) */
  maxTurns: number;
  /** Max budget per query in USD */
  maxQueryBudgetUsd: number;
  /** Fallback model if primary fails */
  fallbackModel?: string;
  /** Max retries on transient errors */
  maxRetries: number;
}

export interface QueryResult {
  /** Final text response from the LLM */
  response: string;
  /** All tool calls made during this query */
  toolCalls: ToolCallResult[];
  /** Total cost of this query */
  costUsd: number;
  /** Total tokens used */
  tokensUsed: { prompt: number; completion: number };
  /** Number of turns taken */
  turns: number;
  /** Whether the loop was truncated */
  truncated: boolean;
  /** Truncation reason */
  truncationReason?: string;
}

/** Callback for streaming progress */
export type QueryProgressCallback = (event: QueryProgressEvent) => void;

export type QueryProgressEvent =
  | { type: "thinking"; text: string }
  | { type: "tool_start"; tool: string; params: Record<string, unknown> }
  | { type: "tool_result"; tool: string; success: boolean; preview: string }
  | { type: "turn_complete"; turn: number; totalCost: number }
  | { type: "response"; text: string }
  | { type: "error"; message: string; recoverable: boolean };

// ═══════════════════════════════════════════════════════════════
//  QUERY LOOP
// ═══════════════════════════════════════════════════════════════

export class QueryLoop {
  private defaultConfig: QueryConfig = {
    maxTurns: 10,
    maxQueryBudgetUsd: 1.0,
    maxRetries: 2,
  };

  constructor(
    private log: GatewayLogger,
    private llm: LLMAdapter,
    private registry: ToolRegistry,
    private costTracker: CostTracker,
    private session: SessionManager,
  ) {}

  /**
   * Execute a multi-turn query loop.
   *
   * Flow:
   * 1. Send system prompt + conversation history + user message to LLM
   * 2. Parse response for tool calls
   * 3. If tool calls found:
   *    a. Validate & execute each tool (parallel if safe)
   *    b. Format results into conversation
   *    c. Send updated conversation back to LLM
   *    d. Repeat from step 2
   * 4. If no tool calls: return final response
   *
   * Safeguards:
   * - Max turns limit prevents infinite loops
   * - Budget check before each turn
   * - Error recovery with retries + fallback model
   * - Context compaction when messages grow too large
   */
  async query(
    systemPrompt: string,
    userMessage: string,
    toolCtx: ToolContext,
    config?: Partial<QueryConfig>,
    onProgress?: QueryProgressCallback,
  ): Promise<QueryResult> {
    const cfg = { ...this.defaultConfig, ...config };

    // Build initial conversation
    const messages: ConversationMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    // Add recent session history for continuity
    const history = this.session.getRecentMessages(20);
    for (const m of history) {
      if (m.role !== "system") {
        messages.push(m);
      }
    }

    // Add user message
    messages.push({ role: "user", content: userMessage });

    // Track results
    const allToolCalls: ToolCallResult[] = [];
    let totalCost = 0;
    let totalTokens = { prompt: 0, completion: 0 };
    let turn = 0;
    let lastResponse = "";
    let truncated = false;
    let truncationReason: string | undefined;
    let currentModel: string | undefined = undefined;
    let retryCount = 0;

    // ─── Multi-turn loop ────────────────────────────────────────

    while (turn < cfg.maxTurns) {
      turn++;

      // Budget check
      if (totalCost >= cfg.maxQueryBudgetUsd) {
        truncated = true;
        truncationReason = `Query-Budget überschritten ($${totalCost.toFixed(4)} >= $${cfg.maxQueryBudgetUsd})`;
        this.log.gateway(`⚠️ ${truncationReason}`);
        break;
      }

      if (this.costTracker.isBudgetExceeded()) {
        truncated = true;
        truncationReason = "Tages-Budget aufgebraucht";
        this.log.gateway(`⚠️ ${truncationReason}`);
        break;
      }

      this.log.exec(`── Turn ${turn}/${cfg.maxTurns} ──`);

      // ─── Call LLM ─────────────────────────────────────────

      let response;
      try {
        const llmMessages = this.formatForLLM(messages);
        const systemMsg = llmMessages.find(m => m.role === "system")?.content;
        const chatMessages = llmMessages.filter(m => m.role !== "system");

        // Use fallback model if primary failed
        const model = currentModel;
        if (model && model !== this.llm.getModel()) {
          this.log.gateway(`🔄 Verwende Fallback-Modell: ${model}`);
        }

        response = await this.llm.send(
          chatMessages as Array<{ role: "user" | "assistant"; content: string }>,
          systemMsg,
        );

        retryCount = 0; // Reset retry count on success
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);

        // ─── Error Recovery ─────────────────────────────────

        // Retry on transient errors
        if (retryCount < cfg.maxRetries && this.isTransientError(errMsg)) {
          retryCount++;
          this.log.error(`LLM Fehler (Retry ${retryCount}/${cfg.maxRetries}): ${errMsg}`);
          onProgress?.({ type: "error", message: errMsg, recoverable: true });

          // Wait before retry (exponential backoff)
          await this.sleep(1000 * Math.pow(2, retryCount));
          turn--; // Don't count as a turn
          continue;
        }

        // Try fallback model
        if (cfg.fallbackModel && currentModel !== cfg.fallbackModel) {
          this.log.gateway(`🔄 Wechsel zu Fallback-Modell: ${cfg.fallbackModel}`);
          currentModel = cfg.fallbackModel;
          this.llm.setModel(cfg.fallbackModel);
          onProgress?.({ type: "error", message: `Wechsel zu ${cfg.fallbackModel}`, recoverable: true });
          turn--; // Don't count as a turn
          continue;
        }

        // Unrecoverable error
        onProgress?.({ type: "error", message: errMsg, recoverable: false });
        throw err;
      }

      // Track costs
      totalCost += response.costUsd;
      totalTokens.prompt += response.tokensUsed.prompt;
      totalTokens.completion += response.tokensUsed.completion;

      this.costTracker.addLlmCost(
        this.llm.getModel(),
        response.tokensUsed.prompt,
        response.tokensUsed.completion,
        response.costUsd,
      );

      lastResponse = response.text;

      // Add assistant message to conversation
      messages.push({ role: "assistant", content: response.text });

      // ─── Parse tool calls ──────────────────────────────────

      const toolCalls = this.registry.parseToolCalls(response.text);

      // Notify progress
      if (toolCalls.length === 0) {
        onProgress?.({ type: "response", text: response.text });
        onProgress?.({ type: "turn_complete", turn, totalCost });
        break; // No more tool calls → final response
      }

      // ─── Execute tools ─────────────────────────────────────

      this.log.exec(`🔧 ${toolCalls.length} Tool-Call(s) in Turn ${turn}`);

      for (const call of toolCalls) {
        onProgress?.({ type: "tool_start", tool: call.tool, params: call.params });
      }

      // Execute with concurrency support
      const results = await this.registry.executeAll(toolCalls, toolCtx);

      // Track tool costs and results
      for (const result of results) {
        allToolCalls.push(result);
        this.costTracker.addToolExecution(
          result.tool,
          result.meta.durationMs,
          !result.success,
          result.meta.costUsd ?? 0,
        );

        const preview = result.success
          ? (result.output.substring(0, 100) + (result.output.length > 100 ? "..." : ""))
          : (result.error ?? "Fehler");
        onProgress?.({ type: "tool_result", tool: result.tool, success: result.success, preview });
      }

      // ─── Feed results back into conversation ──────────────

      for (const result of results) {
        const content = result.success
          ? `Tool ${result.tool} → Erfolg:\n${result.output}`
          : `Tool ${result.tool} → Fehler: ${result.error}`;

        messages.push({
          role: "tool_result",
          toolCallId: result.toolCallId,
          tool: result.tool,
          content,
          isError: !result.success,
        });
      }

      onProgress?.({ type: "turn_complete", turn, totalCost });

      // Context size check — compact if too many messages
      if (messages.length > 50) {
        this.compactMessages(messages);
      }
    }

    // ─── Finalize ───────────────────────────────────────────────

    if (turn >= cfg.maxTurns && !truncated) {
      truncated = true;
      truncationReason = `Max Turns erreicht (${cfg.maxTurns})`;
    }

    // Save to session
    this.session.addMessage({ role: "user", content: userMessage });
    this.session.addMessage({ role: "assistant", content: lastResponse });

    // Restore original model if we switched to fallback
    if (currentModel && currentModel !== this.llm.getModel()) {
      // currentModel was set to fallback — model is already changed via setModel
      // We don't restore here because the fallback might be more reliable
    }

    return {
      response: lastResponse,
      toolCalls: allToolCalls,
      costUsd: totalCost,
      tokensUsed: totalTokens,
      turns: turn,
      truncated,
      truncationReason,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  MESSAGE FORMATTING
  // ═══════════════════════════════════════════════════════════════

  /** Format ConversationMessages for the LLM API */
  private formatForLLM(messages: ConversationMessage[]): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === "tool_result") {
        // Tool results become user messages (LLM sees them as follow-ups)
        result.push({
          role: "user",
          content: msg.content,
        });
      } else {
        result.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Merge consecutive same-role messages
    const merged: typeof result = [];
    for (const msg of result) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        last.content += "\n\n" + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }

    return merged;
  }

  /** Compact messages to save context space */
  private compactMessages(messages: ConversationMessage[]): void {
    // Keep: first system message + last 30 messages
    const keepCount = 30;
    if (messages.length <= keepCount + 1) return;

    const systemMessages = messages.filter(m => m.role === "system");
    const removed = messages.length - keepCount - systemMessages.length;

    // Create compaction summary
    const summary: ConversationMessage = {
      role: "system",
      content: `[Kontextkompaktierung: ${removed} frühere Nachrichten entfernt. ` +
        `Bisherige Tool-Aufrufe und Ergebnisse sind zusammengefasst.]`,
    };

    const kept = messages.slice(-keepCount);
    messages.length = 0;
    messages.push(...systemMessages, summary, ...kept);

    this.log.gateway(`📦 Kontext kompaktiert: entfernt ${removed} Nachrichten`);
  }

  // ═══════════════════════════════════════════════════════════════
  //  ERROR RECOVERY
  // ═══════════════════════════════════════════════════════════════

  private isTransientError(message: string): boolean {
    const transientPatterns = [
      "rate limit",
      "429",
      "503",
      "502",
      "timeout",
      "ECONNRESET",
      "ECONNREFUSED",
      "network",
      "overloaded",
      "capacity",
    ];
    const lower = message.toLowerCase();
    return transientPatterns.some(p => lower.includes(p));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
