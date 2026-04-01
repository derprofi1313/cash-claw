// Telegram Bot Adapter â€“ operator commands + status reports

import type { CashClawConfig } from "../config/types.js";
import type { GatewayLogger } from "./GatewayLogger.js";
import type { AgentState } from "./types.js";

export class TelegramAdapter {
  private botToken: string;
  private operatorChatId: string;
  private operatorAutoLinked = false;
  private pollingActive = false;
  private offset = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private getState: () => AgentState;
  private onCommand: (cmd: string) => void;
  private onMessage?: (text: string) => Promise<string | null | undefined>;

  constructor(
    config: CashClawConfig,
    private log: GatewayLogger,
    getState: () => AgentState,
    onCommand: (cmd: string) => void,
    onMessage?: (text: string) => Promise<string | null | undefined>,
  ) {
    this.botToken = config.platform.telegram?.botToken ?? "";
    this.operatorChatId = config.platform.telegram?.operatorChatId ?? "";
    this.operatorAutoLinked = !this.operatorChatId;
    this.getState = getState;
    this.onCommand = onCommand;
    this.onMessage = onMessage;
  }

  /** Start long-polling for Telegram updates */
  async start(): Promise<void> {
    if (!this.botToken) {
      this.log.error("Kein Telegram Bot Token konfiguriert");
      return;
    }

    // Test connection
    try {
      const me = await this.apiCall("getMe");
      this.log.ok(`Telegram Bot online: @${me.result?.username ?? "unknown"}`);
    } catch (err) {
      this.log.error(`Telegram Verbindung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Send startup message to operator
    if (this.operatorChatId) {
      await this.sendToOperator("ðŸ¦€ *Cash-Claw Gateway gestartet*\nAgent ist online, chatbereit und wartet auf dein Briefing.");
    } else {
      this.log.telegram("Keine operatorChatId gesetzt: erste eingehende Nachricht wird automatisch gebunden.");
    }

    this.pollingActive = true;
    this.poll();
  }

  /** Stop polling */
  stop(): void {
    this.pollingActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.log.telegram("Telegram Polling gestoppt");
  }

  /** Send a message to the operator */
  async sendToOperator(text: string): Promise<void> {
    if (!this.operatorChatId || !this.botToken) return;
    try {
      await this.apiCall("sendMessage", {
        chat_id: this.operatorChatId,
        text,
        parse_mode: "Markdown",
      });
      this.log.telegram(`Nachricht an Operator gesendet`);
    } catch {
      try {
        await this.apiCall("sendMessage", {
          chat_id: this.operatorChatId,
          text,
        });
        this.log.telegram(`Nachricht an Operator gesendet (ohne Markdown)`);
      } catch (fallbackErr) {
        this.log.error(`Telegram Sende-Fehler: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
      }
    }
  }

  /** Send a message with inline keyboard buttons */
  async sendButtons(text: string, buttons: Array<{ text: string; callback_data?: string; url?: string }>): Promise<void> {
    if (!this.operatorChatId || !this.botToken) return;
    try {
      // Arrange buttons in rows of max 3
      const rows: typeof buttons[] = [];
      for (let i = 0; i < buttons.length; i += 3) {
        rows.push(buttons.slice(i, i + 3));
      }
      await this.apiCall("sendMessage", {
        chat_id: this.operatorChatId,
        text,
        parse_mode: "Markdown",
        reply_markup: JSON.stringify({
          inline_keyboard: rows,
        }),
      });
      this.log.telegram(`ðŸ“¤ Nachricht mit Buttons gesendet`);
    } catch (err) {
      this.log.error(`Telegram Button-Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Send a file/document to the operator */
  async sendFile(filePath: string, caption?: string): Promise<void> {
    if (!this.operatorChatId || !this.botToken) return;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendDocument`;
      const formData = new FormData();
      formData.append("chat_id", this.operatorChatId);
      if (caption) formData.append("caption", caption);

      // Read file and create a Blob
      const { readFileSync } = await import("node:fs");
      const { basename } = await import("node:path");
      const fileBuffer = readFileSync(filePath);
      const fileName = basename(filePath);
      formData.append("document", new Blob([fileBuffer]), fileName);

      const res = await fetch(url, {
        method: "POST",
        body: formData,
      });
      const data = await res.json() as { ok?: boolean; description?: string };
      if (!data.ok) {
        throw new Error(data.description ?? "sendDocument fehlgeschlagen");
      }
      this.log.telegram(`ðŸ“¤ Datei gesendet: ${fileName}`);
    } catch (err) {
      this.log.error(`Telegram Datei-Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // â”€â”€â”€ Private â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async poll(): Promise<void> {
    if (!this.pollingActive) return;

    try {
      const data = await this.apiCall("getUpdates", {
        offset: this.offset,
        timeout: 30,
        allowed_updates: JSON.stringify(["message"]),
      });

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      }
    } catch (err) {
      // Network errors are normal during long polling, just retry
      if (this.pollingActive) {
        this.log.error(`Telegram Poll-Fehler: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Schedule next poll
    if (this.pollingActive) {
      this.pollTimer = setTimeout(() => this.poll(), 500);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleUpdate(update: any): Promise<void> {
    const msg = update.message;
    if (!msg?.text) return;

    const chatId = String(msg.chat?.id ?? "");

    if (!this.operatorChatId) {
      this.operatorChatId = chatId;
      this.operatorAutoLinked = true;
      this.log.telegram(`Operator-Chat automatisch gebunden: ${chatId}`);
      await this.reply(chatId, "Operator-Chat wurde automatisch verbunden. Du kannst jetzt direkt mit dem LLM chatten.");
    }

    // Security: only respond to operator, but with explicit feedback instead of silent ignore.
    if (chatId !== this.operatorChatId) {
      this.log.telegram(`Nachricht von unbekannter Chat-ID: ${chatId}`);
      await this.reply(chatId, `Dieser Bot ist mit Chat-ID ${this.operatorChatId} verbunden. Deine Chat-ID ist ${chatId}.`);
      return;
    }

    const text = msg.text.trim();
    this.log.telegram(`ðŸ“¥ Operator: "${text}"`);

    if (text.startsWith("/")) {
      await this.handleCommand(text, chatId);
      return;
    }

    if (!this.onMessage) {
      await this.reply(chatId, "Chat-Handler ist noch nicht bereit. Versuche es gleich nochmal.");
      return;
    }

    try {
      const reply = await this.onMessage(text);
      if (reply && reply.trim().length > 0) {
        await this.reply(chatId, reply);
      }
    } catch (err) {
      this.log.error(`Telegram Chat-Fehler: ${err instanceof Error ? err.message : String(err)}`);
      await this.reply(chatId, "Interner Fehler beim Verarbeiten deiner Nachricht.");
    }
  }

  private async handleCommand(text: string, chatId: string): Promise<void> {
    const cmd = text.split(" ")[0].toLowerCase().replace("@", "");

    switch (cmd) {
      case "/status": {
        const state = this.getState();
        const uptime = state.startedAt
          ? this.formatDuration(Date.now() - state.startedAt.getTime())
          : "â€“";
        const lines = [
          "ðŸ¦€ *Cash-Claw Status*",
          `â–¸ Status: ${state.running ? (state.paused ? "â¸ Pausiert" : "â–¶ï¸ LÃ¤uft") : "â¹ Gestoppt"}`,
          `â–¸ Uptime: ${uptime}`,
          `â–¸ Zyklen: ${state.cycleCount}`,
          `â–¸ Aktionen heute: ${state.actionsToday}`,
          `â–¸ API-Kosten heute: $${state.costToday.toFixed(4)}`,
          `â–¸ Tasks erledigt: ${state.tasksCompleted.length}`,
        ];
        await this.reply(chatId, lines.join("\n"));
        break;
      }

      case "/pause": {
        this.onCommand("pause");
        await this.reply(chatId, "â¸ Agent pausiert.");
        break;
      }

      case "/resume": {
        this.onCommand("resume");
        await this.reply(chatId, "â–¶ï¸ Agent fortgesetzt.");
        break;
      }

      case "/stop": {
        this.onCommand("stop");
        await this.reply(chatId, "â¹ Gateway wird heruntergefahren...");
        break;
      }

      case "/plan": {
        this.onCommand("plan");
        await this.reply(chatId, "ðŸ“‹ Planungszyklus wird ausgelÃ¶st...");
        break;
      }

      case "/reflect": {
        this.onCommand("reflect");
        await this.reply(chatId, "ðŸŒ™ Reflexion wird gestartet...");
        break;
      }

      case "/log": {
        const state = this.getState();
        const recent = state.tasksCompleted.slice(-5);
        if (recent.length === 0) {
          await this.reply(chatId, "ðŸ“œ Noch keine abgeschlossenen Tasks.");
        } else {
          const lines = ["ðŸ“œ *Letzte Tasks:*"];
          for (const r of recent) {
            lines.push(`${r.success ? "âœ…" : "âŒ"} ${r.title} ($${r.costUsd.toFixed(4)}, ${r.durationMs}ms)`);
          }
          await this.reply(chatId, lines.join("\n"));
        }
        break;
      }

      case "/help": {
        await this.reply(chatId, [
          "ðŸ¦€ *Cash-Claw Befehle:*",
          "Normale Textnachrichten = Mitarbeiter-Chat",
          "/status â€“ Aktueller Status",
          "/pause â€“ Agent pausieren",
          "/resume â€“ Agent fortsetzen",
          "/plan â€“ Sofort einen Planungszyklus starten",
          "/reflect â€“ Sofort Tagesreflexion auslÃ¶sen",
          "/log â€“ Letzte Tasks anzeigen",
          "/stop â€“ Gateway herunterfahren",
          "/help â€“ Diese Hilfe",
        ].join("\n"));
        break;
      }

      default: {
        // Unknown slash command falls back to normal LLM chat.
        if (this.onMessage) {
          try {
            const fallbackText = text.replace(/^\//, "");
            const llmReply = await this.onMessage(fallbackText);
            if (llmReply && llmReply.trim().length > 0) {
              await this.reply(chatId, llmReply);
              break;
            }
          } catch (err) {
            this.log.error(`Telegram Slash-Fallback Fehler: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        await this.reply(chatId, `Unbekannter Befehl: ${cmd}\nSende /help fÃ¼r eine Ãœbersicht.`);
        break;
      }
    }
  }

  private async reply(chatId: string, text: string): Promise<void> {
    try {
      await this.apiCall("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      });
    } catch {
      // Retry without Markdown if parsing fails
      try {
        await this.apiCall("sendMessage", {
          chat_id: chatId,
          text,
        });
      } catch (err) {
        this.log.error(`Telegram Reply-Fehler: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async apiCall(method: string, params?: Record<string, unknown>): Promise<any> {
    const url = `https://api.telegram.org/bot${this.botToken}/${method}`;

    if (params && method === "getUpdates") {
      // Use GET with query params for long-polling
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        search.set(k, String(v));
      }
      const res = await fetch(`${url}?${search.toString()}`, {
        signal: AbortSignal.timeout(35_000),
      });
      return res.json();
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: params ? JSON.stringify(params) : undefined,
    });
    return res.json();
  }

  private formatDuration(ms: number): string {
    const sec = Math.floor(ms / 1000) % 60;
    const min = Math.floor(ms / 60_000) % 60;
    const hrs = Math.floor(ms / 3_600_000);
    if (hrs > 0) return `${hrs}h ${min}m`;
    if (min > 0) return `${min}m ${sec}s`;
    return `${sec}s`;
  }
}

