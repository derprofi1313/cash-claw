// WhatsApp Adapter – operator commands + status reports via Baileys
// Mirrors TelegramAdapter functionality for WhatsApp channel

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { CashClawConfig } from "../config/types.js";
import type { GatewayLogger } from "./GatewayLogger.js";
import type { AgentState } from "./types.js";

/**
 * Configuration subset for the WhatsApp adapter.
 */
export interface WhatsAppConfig {
  enabled: boolean;
  operatorNumber: string;
  sessionPath: string;
  reconnectAttempts: number;
}

/**
 * WhatsAppAdapter – connects to WhatsApp via Baileys,
 * provides operator commands identical to TelegramAdapter.
 */
export class WhatsAppAdapter {
  private operatorJid: string;
  private sessionPath: string;
  private reconnectAttempts: number;
  private maxReconnectAttempts: number;
  private connected = false;
  private stopping = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sock: any = null;
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
    const waConfig = config.platform.whatsapp;
    const operatorNumber = waConfig?.operatorNumber ?? "";

    // Convert E.164 format (+491234567890) to WhatsApp JID (491234567890@s.whatsapp.net)
    this.operatorJid = operatorNumber.replace(/^\+/, "") + "@s.whatsapp.net";
    this.sessionPath = waConfig?.sessionPath
      ?? path.join(os.homedir(), ".cashclaw", "whatsapp-session");
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = waConfig?.reconnectAttempts ?? 5;
    this.getState = getState;
    this.onCommand = onCommand;
    this.onMessage = onMessage;
  }

  /**
   * Start the WhatsApp connection.
   * Shows QR code in terminal on first run, then persists session.
   */
  async start(): Promise<void> {
    this.stopping = false;

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }

    try {
      // Dynamic imports for Baileys + qrcode-terminal
      const baileys = await import("@whiskeysockets/baileys");
      const { default: qrcode } = await import("qrcode-terminal");

      const { state, saveCreds } = await baileys.useMultiFileAuthState(this.sessionPath);

      const sock = baileys.makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: {
          // Minimal pino-compatible logger to suppress Baileys noise
          info: () => {},
          error: (msg: unknown) => this.log.error(`Baileys: ${String(msg)}`),
          warn: (msg: unknown) => this.log.gateway(`Baileys warn: ${String(msg)}`),
          debug: () => {},
          trace: () => {},
          fatal: (msg: unknown) => this.log.error(`Baileys fatal: ${String(msg)}`),
          child: () => this,
          level: "silent",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });

      this.sock = sock;

      // Handle connection updates
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sock.ev.on("connection.update", (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.log.gateway("WhatsApp QR-Code im Terminal anzeigen – scanne mit WhatsApp:");
          qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
          this.connected = false;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const isLoggedOut = statusCode === 401;

          if (isLoggedOut) {
            this.log.error("WhatsApp Session ungültig – lösche Session und starte neu");
            // Clear session data for re-auth
            try {
              fs.rmSync(this.sessionPath, { recursive: true, force: true });
              fs.mkdirSync(this.sessionPath, { recursive: true });
            } catch { /* ignore cleanup errors */ }
          }

          if (!this.stopping && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60_000);
            this.log.gateway(
              `WhatsApp disconnected – Reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delayMs}ms`,
            );
            setTimeout(() => {
              if (!this.stopping) void this.start();
            }, delayMs);
          } else if (!this.stopping) {
            this.log.error("WhatsApp max Reconnect-Versuche erreicht – Adapter gestoppt");
          }
        }

        if (connection === "open") {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.log.ok("WhatsApp Verbindung hergestellt");
          void this.sendMessage(this.operatorJid, "🦀 Cash-Claw Gateway gestartet\nAgent ist online. Sende /help für Befehle.");
        }
      });

      // Persist credentials on update
      sock.ev.on("creds.update", saveCreds);

      // Handle incoming messages
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sock.ev.on("messages.upsert", (m: any) => {
        for (const msg of m.messages) {
          if (msg.key.fromMe) continue;
          void this.handleIncoming(msg);
        }
      });

    } catch (err) {
      this.log.error(`WhatsApp Start fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Stop the WhatsApp connection cleanly */
  async stop(): Promise<void> {
    this.stopping = true;
    this.connected = false;
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        // Logout may fail if already disconnected
      }
      this.sock = null;
    }
    this.log.gateway("WhatsApp Adapter gestoppt");
  }

  /** Send a text message to a JID */
  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.sock || !this.connected) {
      this.log.error("WhatsApp nicht verbunden – Nachricht nicht gesendet");
      return;
    }
    try {
      await this.sock.sendMessage(to, { text });
      this.log.gateway("WhatsApp Nachricht gesendet");
    } catch (err) {
      this.log.error(`WhatsApp Sende-Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Send a text message to the operator */
  async sendToOperator(text: string): Promise<void> {
    await this.sendMessage(this.operatorJid, text);
  }

  /** Send typing indicator */
  async sendTyping(to: string): Promise<void> {
    if (!this.sock || !this.connected) return;
    try {
      await this.sock.sendPresenceUpdate("composing", to);
    } catch { /* ignore typing errors */ }
  }

  /** Check if adapter is currently connected */
  isConnected(): boolean {
    return this.connected;
  }

  /** Check if a JID belongs to the operator */
  isOperator(jid: string): boolean {
    // Normalize JID for comparison (strip device suffix like :0)
    const normalizedJid = jid.split(":")[0].split("@")[0];
    const normalizedOperator = this.operatorJid.split("@")[0];
    return normalizedJid === normalizedOperator;
  }

  // ─── Private ──────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleIncoming(msg: any): Promise<void> {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    // Security: only respond to operator
    if (!this.isOperator(jid)) {
      this.log.gateway(`WhatsApp Nachricht von unbekannter JID: ${jid}`);
      await this.sendMessage(jid, "Dieser Bot akzeptiert nur Nachrichten vom konfigurierten Operator.");
      return;
    }

    // Extract text content – reject media messages
    const text = msg.message?.conversation
      ?? msg.message?.extendedTextMessage?.text
      ?? null;

    if (!text) {
      await this.sendMessage(jid, "Ich verstehe nur Text-Befehle. Tippe /help für Hilfe.");
      return;
    }

    this.log.gateway(`WhatsApp Operator: "${text}"`);

    // Handle commands
    if (text.startsWith("/")) {
      await this.handleCommand(text, jid);
      return;
    }

    // Forward to LLM chat
    if (!this.onMessage) {
      await this.sendMessage(jid, "Chat-Handler ist noch nicht bereit. Versuche es gleich nochmal.");
      return;
    }

    try {
      await this.sendTyping(jid);
      const reply = await this.onMessage(text);
      if (reply && reply.trim().length > 0) {
        await this.sendMessage(jid, reply);
      }
    } catch (err) {
      this.log.error(`WhatsApp Chat-Fehler: ${err instanceof Error ? err.message : String(err)}`);
      await this.sendMessage(jid, "Interner Fehler beim Verarbeiten deiner Nachricht.");
    }
  }

  private async handleCommand(text: string, jid: string): Promise<void> {
    const cmd = text.split(" ")[0].toLowerCase();

    switch (cmd) {
      case "/status": {
        const state = this.getState();
        const uptime = state.startedAt
          ? this.formatDuration(Date.now() - state.startedAt.getTime())
          : "–";
        const lines = [
          "🦀 *Cash-Claw Status*",
          `▸ Status: ${state.running ? (state.paused ? "⏸ Pausiert" : "▶️ Läuft") : "⏹ Gestoppt"}`,
          `▸ Uptime: ${uptime}`,
          `▸ Zyklen: ${state.cycleCount}`,
          `▸ Aktionen heute: ${state.actionsToday}`,
          `▸ API-Kosten heute: $${state.costToday.toFixed(4)}`,
          `▸ Tasks erledigt: ${state.tasksCompleted.length}`,
        ];
        await this.sendMessage(jid, lines.join("\n"));
        break;
      }

      case "/pause": {
        this.onCommand("pause");
        await this.sendMessage(jid, "⏸ Agent pausiert.");
        break;
      }

      case "/resume": {
        this.onCommand("resume");
        await this.sendMessage(jid, "▶️ Agent fortgesetzt.");
        break;
      }

      case "/stop": {
        this.onCommand("stop");
        await this.sendMessage(jid, "⏹ Gateway wird heruntergefahren...");
        break;
      }

      case "/plan": {
        this.onCommand("plan");
        await this.sendMessage(jid, "📋 Planungszyklus wird ausgelöst...");
        break;
      }

      case "/reflect": {
        this.onCommand("reflect");
        await this.sendMessage(jid, "🌙 Reflexion wird gestartet...");
        break;
      }

      case "/log": {
        const state = this.getState();
        const recent = state.tasksCompleted.slice(-10);
        if (recent.length === 0) {
          await this.sendMessage(jid, "📜 Noch keine abgeschlossenen Tasks.");
        } else {
          const lines = ["📜 *Letzte Tasks:*"];
          for (const r of recent) {
            lines.push(`${r.success ? "✅" : "❌"} ${r.title} ($${r.costUsd.toFixed(4)}, ${r.durationMs}ms)`);
          }
          await this.sendMessage(jid, lines.join("\n"));
        }
        break;
      }

      case "/help": {
        await this.sendMessage(jid, [
          "🦀 *Cash-Claw Befehle:*",
          "Normale Textnachrichten = Mitarbeiter-Chat",
          "/status – Aktueller Status",
          "/pause – Agent pausieren",
          "/resume – Agent fortsetzen",
          "/plan – Sofort einen Planungszyklus starten",
          "/reflect – Sofort Tagesreflexion auslösen",
          "/log – Letzte Tasks anzeigen",
          "/stop – Gateway herunterfahren",
          "/help – Diese Hilfe",
        ].join("\n"));
        break;
      }

      default: {
        // Unknown slash command falls back to normal LLM chat
        if (this.onMessage) {
          try {
            const fallbackText = text.replace(/^\//, "");
            const llmReply = await this.onMessage(fallbackText);
            if (llmReply && llmReply.trim().length > 0) {
              await this.sendMessage(jid, llmReply);
              break;
            }
          } catch (err) {
            this.log.error(`WhatsApp Slash-Fallback Fehler: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        await this.sendMessage(jid, `Unbekannter Befehl: ${cmd}\nSende /help für eine Übersicht.`);
        break;
      }
    }
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
