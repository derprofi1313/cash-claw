// WebSocketBroadcaster – Centralized WebSocket event broadcasting
// Provides typed event emission for real-time dashboard updates

import type { HttpGateway } from "./HttpGateway.js";
import type { GatewayEvent } from "./protocol/types.js";
import type { DashboardLogEntry } from "./DashboardData.js";

/**
 * Dashboard-specific WebSocket event types.
 */
export type DashboardEvent =
  | { type: "log"; payload: DashboardLogEntry }
  | { type: "ael_cycle"; payload: { phase: "observe" | "plan" | "execute" | "reflect"; task: string } }
  | { type: "tool_call"; payload: { tool: string; duration: number; success: boolean } }
  | { type: "revenue"; payload: { amount: number; currency: string; description: string } }
  | { type: "status"; payload: { state: "running" | "paused" | "idle" } };

/**
 * WebSocketBroadcaster – wrapper for broadcasting typed events.
 */
export class WebSocketBroadcaster {
  private httpGateway: HttpGateway | null = null;

  /**
   * Attach to an HttpGateway for broadcasting.
   */
  attach(gateway: HttpGateway): void {
    this.httpGateway = gateway;
  }

  /**
   * Broadcast a log event.
   */
  broadcastLog(entry: DashboardLogEntry): void {
    this.broadcast("log" as GatewayEvent, entry as unknown as Record<string, unknown>);
  }

  /**
   * Broadcast an AEL cycle phase change.
   */
  broadcastCyclePhase(phase: "observe" | "plan" | "execute" | "reflect", task: string): void {
    this.broadcast("ael_cycle" as GatewayEvent, { phase, task });
  }

  /**
   * Broadcast a tool call event.
   */
  broadcastToolCall(tool: string, duration: number, success: boolean): void {
    this.broadcast("tool_call" as GatewayEvent, { tool, duration, success });
  }

  /**
   * Broadcast a revenue event.
   */
  broadcastRevenue(amount: number, currency: string, description: string): void {
    this.broadcast("revenue" as GatewayEvent, { amount, currency, description });
  }

  /**
   * Broadcast an agent status change.
   */
  broadcastStatus(state: "running" | "paused" | "idle"): void {
    this.broadcast("status" as GatewayEvent, { state });
  }

  private broadcast(event: GatewayEvent, payload: Record<string, unknown>): void {
    if (!this.httpGateway) return;
    this.httpGateway.broadcast(event, payload);
  }
}
