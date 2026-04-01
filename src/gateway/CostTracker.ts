// CostTracker – Per-model usage tracking and budget enforcement
// Inspired by Claude Code's cost-tracker.ts pattern

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GatewayLogger } from "../gateway/GatewayLogger.js";

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  calls: number;
  costUsd: number;
  errors: number;
}

export interface SessionCosts {
  sessionId: string;
  startedAt: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  totalErrors: number;
  perModel: Record<string, ModelUsage>;
  perTool: Record<string, { calls: number; totalMs: number; errors: number }>;
}

export interface DailyCosts {
  date: string;
  totalCostUsd: number;
  totalCalls: number;
  sessions: string[];
}

// ═══════════════════════════════════════════════════════════════
//  COST TRACKER
// ═══════════════════════════════════════════════════════════════

export class CostTracker {
  private sessionId: string;
  private startedAt: Date;
  private perModel = new Map<string, ModelUsage>();
  private perTool = new Map<string, { calls: number; totalMs: number; errors: number }>();
  private dailyBudgetUsd: number;
  private costFilePath: string;

  constructor(
    private log: GatewayLogger,
    dailyBudgetUsd: number,
  ) {
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    this.startedAt = new Date();
    this.dailyBudgetUsd = dailyBudgetUsd;
    this.costFilePath = path.join(os.homedir(), ".cashclaw", "costs");

    // Ensure costs directory exists
    if (!fs.existsSync(this.costFilePath)) {
      fs.mkdirSync(this.costFilePath, { recursive: true });
    }
  }

  // ─── LLM Cost Tracking ───────────────────────────────────────

  /** Record a LLM API call */
  addLlmCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    isError = false,
  ): void {
    const existing = this.perModel.get(model) ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 0,
      costUsd: 0,
      errors: 0,
    };

    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.totalTokens += inputTokens + outputTokens;
    existing.calls++;
    existing.costUsd += costUsd;
    if (isError) existing.errors++;

    this.perModel.set(model, existing);
  }

  // ─── Tool Cost Tracking ──────────────────────────────────────

  /** Record a tool execution */
  addToolExecution(toolName: string, durationMs: number, isError = false, costUsd = 0): void {
    const existing = this.perTool.get(toolName) ?? { calls: 0, totalMs: 0, errors: 0 };
    existing.calls++;
    existing.totalMs += durationMs;
    if (isError) existing.errors++;
    this.perTool.set(toolName, existing);

    // If the tool had an API cost (e.g., Stripe, external APIs), add to "tools" model
    if (costUsd > 0) {
      this.addLlmCost("tool-api", 0, 0, costUsd);
    }
  }

  // ─── Budget Checks ───────────────────────────────────────────

  /** Get total cost for today (across all sessions) */
  getTodayCost(): number {
    const todayFile = this.getDailyFilePath();
    if (!fs.existsSync(todayFile)) return this.getSessionCost();

    try {
      const daily = JSON.parse(fs.readFileSync(todayFile, "utf-8")) as DailyCosts;
      return daily.totalCostUsd + this.getSessionCost();
    } catch {
      return this.getSessionCost();
    }
  }

  /** Get cost for current session only */
  getSessionCost(): number {
    let total = 0;
    for (const usage of this.perModel.values()) {
      total += usage.costUsd;
    }
    return total;
  }

  /** Check if daily budget is exceeded */
  isBudgetExceeded(): boolean {
    return this.getTodayCost() >= this.dailyBudgetUsd;
  }

  /** Get remaining budget for today */
  getRemainingBudget(): number {
    return Math.max(0, this.dailyBudgetUsd - this.getTodayCost());
  }

  /** Check if a specific cost would exceed the budget */
  wouldExceedBudget(additionalCostUsd: number): boolean {
    return (this.getTodayCost() + additionalCostUsd) > this.dailyBudgetUsd;
  }

  // ─── Statistics ──────────────────────────────────────────────

  /** Get total tokens used this session */
  getSessionTokens(): { input: number; output: number; total: number } {
    let input = 0;
    let output = 0;
    for (const usage of this.perModel.values()) {
      input += usage.inputTokens;
      output += usage.outputTokens;
    }
    return { input, output, total: input + output };
  }

  /** Get total API calls this session */
  getSessionCalls(): number {
    let total = 0;
    for (const usage of this.perModel.values()) {
      total += usage.calls;
    }
    return total;
  }

  /** Get total tool executions this session */
  getToolExecutions(): number {
    let total = 0;
    for (const tool of this.perTool.values()) {
      total += tool.calls;
    }
    return total;
  }

  /** Get per-model breakdown */
  getModelBreakdown(): Record<string, ModelUsage> {
    const result: Record<string, ModelUsage> = {};
    for (const [model, usage] of this.perModel) {
      result[model] = { ...usage };
    }
    return result;
  }

  /** Get per-tool breakdown */
  getToolBreakdown(): Record<string, { calls: number; totalMs: number; avgMs: number; errors: number }> {
    const result: Record<string, { calls: number; totalMs: number; avgMs: number; errors: number }> = {};
    for (const [tool, stats] of this.perTool) {
      result[tool] = {
        ...stats,
        avgMs: stats.calls > 0 ? Math.round(stats.totalMs / stats.calls) : 0,
      };
    }
    return result;
  }

  /** Get full session summary */
  getSessionSummary(): SessionCosts {
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt.toISOString(),
      totalCostUsd: this.getSessionCost(),
      totalInputTokens: this.getSessionTokens().input,
      totalOutputTokens: this.getSessionTokens().output,
      totalCalls: this.getSessionCalls(),
      totalErrors: Array.from(this.perModel.values()).reduce((s, u) => s + u.errors, 0),
      perModel: this.getModelBreakdown(),
      perTool: Object.fromEntries(
        Array.from(this.perTool.entries()).map(([k, v]) => [k, v]),
      ),
    };
  }

  /** Format a cost report for Telegram/log output */
  formatReport(): string {
    const tokens = this.getSessionTokens();
    const cost = this.getSessionCost();
    const remaining = this.getRemainingBudget();
    const lines = [
      `💰 *Session-Kosten*`,
      `▸ Gesamt: $${cost.toFixed(4)}`,
      `▸ Budget rest: $${remaining.toFixed(2)} / $${this.dailyBudgetUsd.toFixed(2)}`,
      `▸ API-Calls: ${this.getSessionCalls()}`,
      `▸ Tokens: ${tokens.total.toLocaleString()} (${tokens.input.toLocaleString()} in / ${tokens.output.toLocaleString()} out)`,
      `▸ Tool-Ausführungen: ${this.getToolExecutions()}`,
    ];

    const models = this.getModelBreakdown();
    if (Object.keys(models).length > 0) {
      lines.push(`\n📊 *Per-Model:*`);
      for (const [model, usage] of Object.entries(models)) {
        lines.push(`  ${model}: $${usage.costUsd.toFixed(4)} (${usage.calls} calls)`);
      }
    }

    return lines.join("\n");
  }

  // ─── Persistence ─────────────────────────────────────────────

  /** Save session costs to disk */
  saveSession(): void {
    try {
      const summary = this.getSessionSummary();

      // Save session file
      const sessionFile = path.join(this.costFilePath, `${this.sessionId}.json`);
      fs.writeFileSync(sessionFile, JSON.stringify(summary, null, 2), "utf-8");

      // Update daily aggregate
      this.updateDailyAggregate(summary);

      this.log.ok(`💾 Session-Kosten gespeichert: $${summary.totalCostUsd.toFixed(4)}`);
    } catch (err) {
      this.log.error(`Kosten-Speicherung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private updateDailyAggregate(session: SessionCosts): void {
    const dailyFile = this.getDailyFilePath();
    let daily: DailyCosts;

    if (fs.existsSync(dailyFile)) {
      try {
        daily = JSON.parse(fs.readFileSync(dailyFile, "utf-8"));
      } catch {
        daily = this.newDailyCosts();
      }
    } else {
      daily = this.newDailyCosts();
    }

    // Idempotent: If this session was already recorded, subtract old values first
    const alreadyRecorded = daily.sessions.includes(session.sessionId);
    if (alreadyRecorded) {
      // Re-read old session file to get previous values and subtract them
      const oldSessionFile = path.join(this.costFilePath, `${session.sessionId}.json`);
      if (fs.existsSync(oldSessionFile)) {
        try {
          const oldSession = JSON.parse(fs.readFileSync(oldSessionFile, "utf-8")) as SessionCosts;
          daily.totalCostUsd -= oldSession.totalCostUsd;
          daily.totalCalls -= oldSession.totalCalls;
        } catch {
          // If we can't read old session, we can't fix it — skip subtraction
        }
      }
    } else {
      daily.sessions.push(session.sessionId);
    }

    // Add current values
    daily.totalCostUsd += session.totalCostUsd;
    daily.totalCalls += session.totalCalls;

    // Guard against negative values from rounding
    daily.totalCostUsd = Math.max(0, daily.totalCostUsd);
    daily.totalCalls = Math.max(0, daily.totalCalls);

    fs.writeFileSync(dailyFile, JSON.stringify(daily, null, 2), "utf-8");
  }

  private getDailyFilePath(): string {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.costFilePath, `daily-${date}.json`);
  }

  private newDailyCosts(): DailyCosts {
    return {
      date: new Date().toISOString().split("T")[0],
      totalCostUsd: 0,
      totalCalls: 0,
      sessions: [],
    };
  }
}
