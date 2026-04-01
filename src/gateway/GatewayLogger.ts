// Gateway Logger – typed wrapper around EventEmitter for debug output

import { EventEmitter } from "node:events";

export type LogCategory =
  | "GATEWAY" | "CONFIG" | "LLM" | "THINK" | "PLAN"
  | "EXEC" | "TELEGRAM" | "STRIPE" | "ERROR" | "OK"
  | "VALIDATE" | "API" | "BACKEND";

// Patterns that match common secret formats in log output
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Anthropic keys
  { pattern: /sk-ant-[a-zA-Z0-9_-]{10,}/g, replacement: "sk-ant-***" },
  // OpenAI keys
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: "sk-***" },
  // Stripe keys
  { pattern: /sk_(?:live|test)_[a-zA-Z0-9]{10,}/g, replacement: "sk_***" },
  { pattern: /whsec_[a-zA-Z0-9]{10,}/g, replacement: "whsec_***" },
  // Telegram bot tokens
  { pattern: /\b\d{8,12}:[A-Za-z0-9_-]{30,}/g, replacement: "bot***:***" },
  // Google API keys
  { pattern: /AIza[a-zA-Z0-9_-]{30,}/g, replacement: "AIza***" },
  // Generic bearer tokens in URLs/headers
  { pattern: /(?<=key=)[a-zA-Z0-9_-]{20,}/g, replacement: "***" },
];

export class GatewayLogger {
  constructor(private emitter: EventEmitter, private verbose: boolean = true) {}

  log(category: LogCategory, message: string): void {
    if (!this.verbose && !["ERROR", "OK", "GATEWAY"].includes(category)) return;
    const redacted = this.redactSecrets(message);
    this.emitter.emit("debug", { category, message: redacted, timestamp: new Date() });
  }

  gateway(msg: string) { this.log("GATEWAY", msg); }
  config(msg: string) { this.log("CONFIG", msg); }
  llm(msg: string) { this.log("LLM", msg); }
  think(msg: string) { this.log("THINK", msg); }
  plan(msg: string) { this.log("PLAN", msg); }
  exec(msg: string) { this.log("EXEC", msg); }
  telegram(msg: string) { this.log("TELEGRAM", msg); }
  stripe(msg: string) { this.log("STRIPE", msg); }
  error(msg: string) { this.log("ERROR", msg); }
  ok(msg: string) { this.log("OK", msg); }

  /** Mask an API key for safe logging */
  maskKey(key: string): string {
    if (!key || key.length < 12) return "***";
    return key.substring(0, 8) + "..." + key.substring(key.length - 4);
  }

  /** Redact known secret patterns from a log message */
  private redactSecrets(message: string): string {
    let result = message;
    for (const { pattern, replacement } of SECRET_PATTERNS) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
    }
    return result;
  }
}
