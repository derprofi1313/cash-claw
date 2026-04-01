// Cash-Claw ConfigBridge
// Central module that reads/writes config and validates keys against live APIs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import type { CashClawConfig } from "./types.js";
import { createDefaultConfig } from "./types.js";
import { isEncryptedConfig, decryptConfig, encryptConfig } from "./ConfigEncryption.js";

export interface ConfigEvent {
  category: "CONFIG" | "VALIDATE" | "API" | "BACKEND" | "ERROR" | "OK";
  message: string;
  timestamp: Date;
}

export class ConfigBridge extends EventEmitter {
  private config: CashClawConfig;
  private configDir: string;
  private configPath: string;
  private encryptionPassword: string | null = null;

  constructor() {
    super();
    this.configDir = path.join(os.homedir(), ".cashclaw");
    this.configPath = path.join(this.configDir, "config.json");
    this.config = createDefaultConfig();
  }

  private emit_debug(category: ConfigEvent["category"], message: string): void {
    const event: ConfigEvent = { category, message, timestamp: new Date() };
    this.emit("debug", event);
  }

  /** Ensure ~/.cashclaw/ directory exists */
  ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
      this.emit_debug("CONFIG", `Created config directory: ${this.configDir}`);
    }
  }

  /** Load existing config from disk (supports encrypted configs) */
  load(password?: string): CashClawConfig {
    this.ensureConfigDir();
    if (fs.existsSync(this.configPath)) {
      const raw = fs.readFileSync(this.configPath, "utf-8");

      if (isEncryptedConfig(this.configPath)) {
        if (!password) {
          throw new Error("Config is encrypted. Provide password via --password or CASHCLAW_CONFIG_PASSWORD env var.");
        }
        this.encryptionPassword = password;
        const decrypted = decryptConfig(raw, password);
        this.config = JSON.parse(decrypted) as CashClawConfig;
        this.emit_debug("CONFIG", `Loaded encrypted config from ${this.configPath}`);
      } else {
        this.config = JSON.parse(raw) as CashClawConfig;
        this.emit_debug("CONFIG", `Loaded config from ${this.configPath}`);
      }

      // Store password for future saves if provided
      if (password && !this.encryptionPassword) {
        this.encryptionPassword = password;
      }
    } else {
      this.config = createDefaultConfig();
      this.emit_debug("CONFIG", "No existing config found, using defaults");
    }
    return this.config;
  }

  /** Write the full config to disk (encrypts if password is set) */
  save(): void {
    this.ensureConfigDir();
    this.config.updatedAt = new Date().toISOString();
    const json = JSON.stringify(this.config, null, 2);

    if (this.encryptionPassword) {
      const encrypted = encryptConfig(json, this.encryptionPassword);
      fs.writeFileSync(this.configPath, encrypted, "utf-8");
      this.emit_debug("CONFIG", `Saved encrypted config to ${this.configPath}`);
    } else {
      fs.writeFileSync(this.configPath, json, "utf-8");
      this.emit_debug("CONFIG", `Saved config to ${this.configPath}`);
    }
  }

  /** Enable encryption for future saves */
  enableEncryption(password: string): void {
    this.encryptionPassword = password;
    this.save();
    this.emit_debug("CONFIG", "Config encryption enabled (AES-256-GCM)");
  }

  /** Disable encryption (save as plaintext) */
  disableEncryption(): void {
    this.encryptionPassword = null;
    this.save();
    this.emit_debug("CONFIG", "Config encryption disabled");
  }

  /** Check if config is currently encrypted */
  isEncrypted(): boolean {
    return isEncryptedConfig(this.configPath);
  }

  /** Update a single top-level section and save immediately */
  patch<K extends keyof CashClawConfig>(key: K, value: CashClawConfig[K]): void {
    this.config[key] = value;
    this.emit_debug("CONFIG", `Updated: ${String(key)} = ${JSON.stringify(value)}`);
    this.save();
  }

  /** Update a nested field via dot-path and save */
  set(dotPath: string, value: unknown): void {
    const keys = dotPath.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let target: any = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (target[keys[i]] === undefined) {
        target[keys[i]] = {};
      }
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
    this.emit_debug("CONFIG", `Set ${dotPath} = ${JSON.stringify(value)}`);
    this.save();
  }

  /** Get current config */
  getConfig(): CashClawConfig {
    return this.config;
  }

  /** Get config directory path */
  getConfigDir(): string {
    return this.configDir;
  }

  /** Get config file path */
  getConfigPath(): string {
    return this.configPath;
  }

  // --- Live Validation Methods ---

  async validateTelegramToken(token: string): Promise<{ valid: boolean; botName?: string; error?: string }> {
    this.emit_debug("VALIDATE", `Testing Telegram Bot Token...`);
    try {
      const url = `https://api.telegram.org/bot${token}/getMe`;
      this.emit_debug("API", `GET ${url.replace(token, "***")}`);
      const response = await fetch(url);
      const data = await response.json() as { ok: boolean; result?: { username: string } };
      if (data.ok && data.result) {
        this.emit_debug("VALIDATE", `Token valid – Bot: @${data.result.username}`);
        return { valid: true, botName: data.result.username };
      }
      this.emit_debug("ERROR", `Telegram token invalid: ${JSON.stringify(data)}`);
      return { valid: false, error: "Token rejected by Telegram API" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit_debug("ERROR", `Telegram validation failed: ${msg}`);
      return { valid: false, error: msg };
    }
  }

  async validateStripeKey(key: string): Promise<{ valid: boolean; error?: string }> {
    this.emit_debug("VALIDATE", `Testing Stripe Secret Key...`);
    try {
      this.emit_debug("API", `GET https://api.stripe.com/v1/customers?limit=1`);
      const response = await fetch("https://api.stripe.com/v1/customers?limit=1", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (response.ok) {
        this.emit_debug("VALIDATE", `Stripe key valid`);
        return { valid: true };
      }
      const data = await response.json() as { error?: { message?: string } };
      this.emit_debug("ERROR", `Stripe key invalid: ${data?.error?.message ?? response.statusText}`);
      return { valid: false, error: data?.error?.message ?? response.statusText };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit_debug("ERROR", `Stripe validation failed: ${msg}`);
      return { valid: false, error: msg };
    }
  }

  async validateAnthropicKey(key: string): Promise<{ valid: boolean; error?: string }> {
    this.emit_debug("VALIDATE", `Testing Anthropic API Key...`);
    try {
      this.emit_debug("API", `GET https://api.anthropic.com/v1/models`);
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      });
      if (response.ok) {
        this.emit_debug("VALIDATE", `Anthropic key valid`);
        return { valid: true };
      }
      this.emit_debug("ERROR", `Anthropic key invalid: ${response.statusText}`);
      return { valid: false, error: response.statusText };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit_debug("ERROR", `Anthropic validation failed: ${msg}`);
      return { valid: false, error: msg };
    }
  }

  async validateOpenAIKey(key: string): Promise<{ valid: boolean; error?: string }> {
    this.emit_debug("VALIDATE", `Testing OpenAI API Key...`);
    try {
      this.emit_debug("API", `GET https://api.openai.com/v1/models`);
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (response.ok) {
        this.emit_debug("VALIDATE", `OpenAI key valid`);
        return { valid: true };
      }
      this.emit_debug("ERROR", `OpenAI key invalid: ${response.statusText}`);
      return { valid: false, error: response.statusText };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit_debug("ERROR", `OpenAI validation failed: ${msg}`);
      return { valid: false, error: msg };
    }
  }

  /** Generate GOALS.md from current config */
  generateGoalsMd(workspaceDir: string): string {
    const goals: string[] = ["# GOALS.md – Auto-generated by Cash-Claw Onboarding", ""];
    goals.push("## Aktive Ziele");

    if (this.config.categories.outreach) {
      goals.push("- [ ] 5 neue Cold-E-Mails pro Tag versenden (Methode: email-outreach)");
    }
    if (this.config.categories.content) {
      goals.push("- [ ] Täglich 1 YouTube-Skript generieren und hochladen");
      goals.push("- [ ] 2 Blog-Artikel pro Woche veröffentlichen");
    }
    if (this.config.categories?.finance) {
      goals.push(`- [ ] Krypto-Portfolio täglich rebalancen (max. ${this.config.financeLimits?.maxDailyRiskPercent ?? 2}% Tagesrisiko)`);
    }
    if (this.config.categories.products) {
      goals.push("- [ ] 1 neues digitales Produkt pro Woche erstellen");
    }

    goals.push("");
    goals.push("## Constraints");
    goals.push(`- Agent aktiv von ${this.config.schedule?.activeFrom ?? "00:00"} bis ${this.config.schedule?.activeTo ?? "24:00"}`);
    goals.push(`- Maximales Tagesbudget für API-Calls: ${this.config.financeLimits?.dailyApiBudgetUsd ?? 5} USD`);
    goals.push(`- Stripe-Auszahlung erst ab ${this.config.stripe?.minPayout ?? 50} EUR Guthaben`);
    goals.push(`- Max. ${this.config.schedule?.maxActionsPerDay ?? 50} Aktionen pro Tag`);

    if (this.config.categories.finance) {
      goals.push(`- allow_financial: true`);
    }

    goals.push("");

    const content = goals.join("\n");
    const goalsPath = path.join(workspaceDir, "GOALS.md");
    fs.writeFileSync(goalsPath, content, "utf-8");
    this.emit_debug("CONFIG", `Generated GOALS.md at ${goalsPath}`);
    return content;
  }
}
