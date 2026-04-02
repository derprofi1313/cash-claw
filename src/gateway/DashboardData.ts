// DashboardData – Aggregates data from various subsystems for the dashboard
// Provides unified data access for API endpoints and WebSocket events

import type { CostTracker } from "./CostTracker.js";
import type { LearningSystem } from "./LearningSystem.js";
import type { SessionManager } from "./SessionManager.js";
import type { AgentRuntime } from "./AgentRuntime.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { DailyReflection, ReflectionResult } from "./DailyReflection.js";
import type { MonetizationSkills } from "./MonetizationSkills.js";
import type { SandboxManager } from "./SandboxManager.js";
import type { CashClawConfig } from "../config/types.js";

/**
 * Revenue summary from Stripe data.
 */
export interface RevenueSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  currency: string;
  recentPayments: Array<{
    date: string;
    amount: number;
    description: string;
    status: string;
  }>;
  dailyRevenue: Array<{ date: string; amount: number }>;
  categories: Record<string, number>;
}

/**
 * Tool performance statistics.
 */
export interface ToolStats {
  name: string;
  callsToday: number;
  avgDurationMs: number;
  successRate: number;
  lastCalled: string | null;
}

/**
 * Agent status snapshot for the dashboard.
 */
export interface AgentStatus {
  state: "running" | "paused" | "idle";
  cyclePhase: "observe" | "plan" | "execute" | "reflect" | "idle";
  currentTask: string | null;
  cycleCount: number;
  actionsToday: number;
  costToday: number;
  uptime: number;
  channels: {
    telegram: "connected" | "disconnected" | "disabled";
    whatsapp: "connected" | "disconnected" | "disabled";
    docker: "available" | "not_installed" | "disabled";
  };
}

/**
 * Log entry for the live feed.
 */
export interface DashboardLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "tool_call";
  message: string;
}

/**
 * DashboardData – aggregates data from multiple subsystems.
 */
export class DashboardData {
  private logBuffer: DashboardLogEntry[] = [];
  private maxLogEntries = 500;

  constructor(
    private costTracker: CostTracker,
    private learningSystem: LearningSystem,
    private sessionManager: SessionManager,
    private runtime: AgentRuntime,
    private registry: ToolRegistry,
    private reflection: DailyReflection | null,
    private skills: MonetizationSkills | null,
    private sandboxManager: SandboxManager | null,
    private config: CashClawConfig,
  ) {}

  /**
   * Get revenue summary (mock when Stripe not connected).
   */
  async getRevenueSummary(): Promise<RevenueSummary> {
    // Return mock data when Stripe is not configured
    if (!this.config.stripe?.secretKey) {
      return {
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
        currency: this.config.agent?.currency ?? "EUR",
        recentPayments: [],
        dailyRevenue: [],
        categories: {},
      };
    }

    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(this.config.stripe.secretKey);

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const charges = await stripe.charges.list({
        created: { gte: Math.floor(monthStart.getTime() / 1000) },
        limit: 100,
      });

      let today = 0;
      let thisWeek = 0;
      let thisMonth = 0;
      const categories: Record<string, number> = {};
      const dailyMap = new Map<string, number>();
      const recentPayments: RevenueSummary["recentPayments"] = [];

      for (const charge of charges.data) {
        if (charge.status !== "succeeded") continue;
        const amount = charge.amount / 100;
        const chargeDate = new Date(charge.created * 1000);
        const dateStr = chargeDate.toISOString().split("T")[0];

        thisMonth += amount;
        if (chargeDate >= weekStart) thisWeek += amount;
        if (chargeDate >= todayStart) today += amount;

        dailyMap.set(dateStr, (dailyMap.get(dateStr) ?? 0) + amount);

        const category = (charge.metadata?.category as string) ?? "other";
        categories[category] = (categories[category] ?? 0) + amount;

        recentPayments.push({
          date: chargeDate.toISOString(),
          amount,
          description: charge.description ?? "Payment",
          status: charge.status,
        });
      }

      const dailyRevenue = Array.from(dailyMap.entries())
        .map(([date, amount]) => ({ date, amount }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        today,
        thisWeek,
        thisMonth,
        currency: this.config.agent?.currency ?? "EUR",
        recentPayments: recentPayments.slice(0, 20),
        dailyRevenue,
        categories,
      };
    } catch {
      return {
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
        currency: this.config.agent?.currency ?? "EUR",
        recentPayments: [],
        dailyRevenue: [],
        categories: {},
      };
    }
  }

  /**
   * Get tool performance statistics.
   */
  getToolStats(): ToolStats[] {
    const breakdown = this.costTracker.getToolBreakdown();
    const stats: ToolStats[] = [];

    for (const tool of this.registry.getAll()) {
      const toolData = breakdown[tool.name];
      stats.push({
        name: tool.name,
        callsToday: toolData?.calls ?? 0,
        avgDurationMs: toolData?.avgMs ?? 0,
        successRate: toolData ? ((toolData.calls - toolData.errors) / Math.max(1, toolData.calls)) * 100 : 100,
        lastCalled: null,
      });
    }

    return stats.sort((a, b) => b.callsToday - a.callsToday);
  }

  /**
   * Get current agent status.
   */
  getAgentStatus(): AgentStatus {
    const state = this.runtime.getState();

    return {
      state: state.running ? (state.paused ? "paused" : "running") : "idle",
      cyclePhase: "idle",
      currentTask: state.currentTask?.title ?? null,
      cycleCount: state.cycleCount,
      actionsToday: state.actionsToday,
      costToday: state.costToday,
      uptime: process.uptime(),
      channels: {
        telegram: this.config.platform.telegram?.botToken ? "connected" : "disabled",
        whatsapp: this.config.platform.whatsapp?.operatorNumber ? "connected" : "disabled",
        docker: this.sandboxManager?.isEnabled() ? "available" : "disabled",
      },
    };
  }

  /**
   * Get recent log entries.
   */
  getRecentLogs(limit: number): DashboardLogEntry[] {
    return this.logBuffer.slice(-limit);
  }

  /**
   * Add a log entry to the buffer.
   */
  addLog(level: DashboardLogEntry["level"], message: string): void {
    this.logBuffer.push({
      timestamp: new Date().toISOString(),
      level,
      message,
    });
    if (this.logBuffer.length > this.maxLogEntries) {
      this.logBuffer = this.logBuffer.slice(-this.maxLogEntries);
    }
  }

  /**
   * Get masked config for display (no secrets).
   */
  getMaskedConfig(): Record<string, unknown> {
    return {
      version: this.config.version,
      agent: this.config.agent,
      llm: {
        provider: this.config.llm.provider,
        model: this.config.llm.model,
        apiKey: "***",
      },
      platform: {
        type: this.config.platform.type,
        telegram: this.config.platform.telegram
          ? { botToken: "***", operatorChatId: this.config.platform.telegram.operatorChatId }
          : undefined,
        whatsapp: this.config.platform.whatsapp
          ? { operatorNumber: this.config.platform.whatsapp.operatorNumber }
          : undefined,
      },
      stripe: {
        secretKey: "***",
        webhookSecret: this.config.stripe?.webhookSecret ? "***" : undefined,
        minPayout: this.config.stripe?.minPayout,
        connected: !!this.config.stripe?.secretKey,
      },
      categories: this.config.categories,
      financeLimits: this.config.financeLimits,
      schedule: this.config.schedule,
      docker: this.config.docker,
      channels: {
        telegram: this.config.platform.telegram?.botToken ? "connected" : "disabled",
        whatsapp: this.config.platform.whatsapp?.operatorNumber ? "connected" : "disabled",
        docker: this.sandboxManager?.isEnabled() ? "available" : "not_installed",
      },
    };
  }

  /**
   * Get sandbox status info.
   */
  async getSandboxStatus(): Promise<{
    available: boolean;
    enabled: boolean;
    version: string;
  }> {
    if (!this.sandboxManager) {
      return { available: false, enabled: false, version: "N/A" };
    }
    const status = await this.sandboxManager.getDockerStatus();
    return {
      available: status.available,
      enabled: status.enabled,
      version: status.version,
    };
  }
}
