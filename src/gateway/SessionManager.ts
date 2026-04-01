// SessionManager – Conversation persistence and resumption
// Inspired by Claude Code's session memory and transcript recording

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GatewayLogger } from "./GatewayLogger.js";
import type { ConversationMessage } from "../tools/Tool.js";

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

export interface Session {
  id: string;
  startedAt: string;
  lastActivity: string;
  messages: ConversationMessage[];
  cycleCount: number;
  totalCostUsd: number;
  status: "active" | "paused" | "completed";
}

export interface SessionMeta {
  id: string;
  startedAt: string;
  lastActivity: string;
  messageCount: number;
  cycleCount: number;
  totalCostUsd: number;
  status: Session["status"];
}

// ═══════════════════════════════════════════════════════════════
//  SESSION MANAGER
// ═══════════════════════════════════════════════════════════════

export class SessionManager {
  private sessionsDir: string;
  private currentSession: Session;
  private maxMessages = 200;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private log: GatewayLogger) {
    this.sessionsDir = path.join(os.homedir(), ".cashclaw", "sessions");
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    this.currentSession = this.createNewSession();
    this.startAutoSave();
  }

  // ─── Session Lifecycle ───────────────────────────────────────

  /** Create a new session */
  private createNewSession(): Session {
    return {
      id: `s-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      messages: [],
      cycleCount: 0,
      totalCostUsd: 0,
      status: "active",
    };
  }

  /** Get current session ID */
  getSessionId(): string {
    return this.currentSession.id;
  }

  /** Get current session status */
  getStatus(): Session["status"] {
    return this.currentSession.status;
  }

  // ─── Message Management ──────────────────────────────────────

  /** Add a message to the conversation history */
  addMessage(message: ConversationMessage): void {
    this.currentSession.messages.push(message);
    this.currentSession.lastActivity = new Date().toISOString();

    // Token budget management: compact old messages if over limit
    if (this.currentSession.messages.length > this.maxMessages) {
      this.compact();
    }
  }

  /** Add multiple messages */
  addMessages(messages: ConversationMessage[]): void {
    for (const msg of messages) {
      this.addMessage(msg);
    }
  }

  /** Get full conversation history */
  getMessages(): ConversationMessage[] {
    return [...this.currentSession.messages];
  }

  /** Get recent N messages */
  getRecentMessages(count: number): ConversationMessage[] {
    return this.currentSession.messages.slice(-count);
  }

  /** Get messages formatted for LLM API calls */
  getMessagesForLLM(): Array<{ role: string; content: string }> {
    return this.currentSession.messages
      .filter(m => m.role !== "tool_result") // Tool results are injected inline
      .map(m => ({
        role: m.role,
        content: m.content,
      }));
  }

  /** Clear all messages (new conversation) */
  clearMessages(): void {
    this.currentSession.messages = [];
  }

  // ─── Context Compaction (inspired by Claude Code's snip/compact) ──

  /** Compact old messages to save tokens */
  private compact(): void {
    const messages = this.currentSession.messages;
    const keepRecent = Math.floor(this.maxMessages * 0.6); // Keep 60% of max

    if (messages.length <= keepRecent) return;

    // Keep system messages + recent messages
    const systemMessages = messages.filter(m => m.role === "system");
    const recentMessages = messages.slice(-keepRecent);

    // Create a summary of removed messages
    const removedCount = messages.length - keepRecent - systemMessages.length;
    const summaryMessage: ConversationMessage = {
      role: "system",
      content: `[Kontext-Kompaktierung: ${removedCount} ältere Nachrichten zusammengefasst. ` +
        `Der Agent hat bisher ${this.currentSession.cycleCount} Zyklen durchlaufen ` +
        `und $${this.currentSession.totalCostUsd.toFixed(4)} ausgegeben.]`,
    };

    this.currentSession.messages = [...systemMessages, summaryMessage, ...recentMessages];
    this.log.gateway(`📦 Konversation kompaktiert: ${messages.length} → ${this.currentSession.messages.length} Nachrichten`);
  }

  // ─── Cycle Tracking ──────────────────────────────────────────

  /** Record a completed cycle */
  recordCycle(costUsd: number): void {
    this.currentSession.cycleCount++;
    this.currentSession.totalCostUsd += costUsd;
  }

  // ─── Persistence ─────────────────────────────────────────────

  /** Save current session to disk */
  save(): void {
    try {
      const filePath = path.join(this.sessionsDir, `${this.currentSession.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2), "utf-8");
    } catch (err) {
      this.log.error(`Session-Speicherung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Resume the latest session */
  resumeLatest(): boolean {
    try {
      const files = fs.readdirSync(this.sessionsDir)
        .filter(f => f.startsWith("s-") && f.endsWith(".json"))
        .sort()
        .reverse();

      if (files.length === 0) return false;

      const latestFile = path.join(this.sessionsDir, files[0]);
      const session = JSON.parse(fs.readFileSync(latestFile, "utf-8")) as Session;

      if (session.status === "completed") return false;

      this.currentSession = session;
      this.currentSession.status = "active";
      this.currentSession.lastActivity = new Date().toISOString();
      this.log.ok(`📂 Session fortgesetzt: ${session.id} (${session.messages.length} Nachrichten)`);
      return true;
    } catch {
      return false;
    }
  }

  /** List all sessions */
  listSessions(): SessionMeta[] {
    try {
      const files = fs.readdirSync(this.sessionsDir)
        .filter(f => f.startsWith("s-") && f.endsWith(".json"))
        .sort()
        .reverse();

      return files.map(f => {
        const session = JSON.parse(
          fs.readFileSync(path.join(this.sessionsDir, f), "utf-8"),
        ) as Session;
        return {
          id: session.id,
          startedAt: session.startedAt,
          lastActivity: session.lastActivity,
          messageCount: session.messages.length,
          cycleCount: session.cycleCount,
          totalCostUsd: session.totalCostUsd,
          status: session.status,
        };
      }).slice(0, 20); // Last 20 sessions
    } catch {
      return [];
    }
  }

  /** Mark current session as completed and save */
  complete(): void {
    this.currentSession.status = "completed";
    this.save();
  }

  /** Save session transcript as Markdown */
  saveTranscript(): void {
    try {
      const transcriptDir = path.join(os.homedir(), ".cashclaw", "transcripts");
      if (!fs.existsSync(transcriptDir)) {
        fs.mkdirSync(transcriptDir, { recursive: true });
      }

      const lines = [
        `# Session Transcript: ${this.currentSession.id}`,
        `Started: ${this.currentSession.startedAt}`,
        `Cycles: ${this.currentSession.cycleCount}`,
        `Cost: $${this.currentSession.totalCostUsd.toFixed(4)}`,
        "",
        "---",
        "",
      ];

      for (const msg of this.currentSession.messages) {
        const label = msg.role === "system" ? "🔧 SYSTEM"
          : msg.role === "user" ? "👤 USER"
          : msg.role === "assistant" ? "🤖 ASSISTANT"
          : "📦 TOOL";
        lines.push(`### ${label}`);
        lines.push(msg.content.substring(0, 2000));
        lines.push("");
      }

      const date = new Date().toISOString().split("T")[0];
      const transcriptFile = path.join(transcriptDir, `${date}-${this.currentSession.id}.md`);
      fs.writeFileSync(transcriptFile, lines.join("\n"), "utf-8");
      this.log.ok(`📜 Transcript gespeichert: ${transcriptFile}`);
    } catch (err) {
      this.log.error(`Transcript-Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Auto-Save ───────────────────────────────────────────────

  private startAutoSave(): void {
    // Save every 2 minutes
    this.autoSaveInterval = setInterval(() => {
      this.save();
    }, 2 * 60_000);
  }

  /** Stop auto-save and do final save */
  stop(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
    this.save();
  }
}
