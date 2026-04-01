// BootstrapManager – Loads and injects identity files into the system prompt
// Reads bootstrap/ directory and builds the agent's identity context

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GatewayLogger } from "./GatewayLogger.js";
import type { CashClawConfig } from "../config/types.js";

export interface BootstrapFiles {
  identity: string;
  soul: string;
  tools: string;
  rules: string;
  owner: string;
  services: string;
  goals: string;
  bootstrap: string;
}

export interface BootstrapState {
  bootstrapCompleted: boolean;
  firstStartDate: string | null;
  filesLoaded: string[];
  totalSize: number;
}

export class BootstrapManager {
  private bootstrapDir: string;
  private stateFile: string;
  private state: BootstrapState;
  private files: Partial<BootstrapFiles> = {};

  constructor(private log: GatewayLogger) {
    // Bootstrap files live in the project's bootstrap/ directory
    // but at runtime we read from ~/.cashclaw/bootstrap/
    this.bootstrapDir = path.join(os.homedir(), ".cashclaw", "bootstrap");
    this.stateFile = path.join(os.homedir(), ".cashclaw", "bootstrap-state.json");
    this.state = this.loadState();
  }

  /** Initialize: copy bootstrap files from project if not present, then load */
  init(projectBootstrapDir?: string, config?: CashClawConfig): void {
    // Ensure bootstrap dir exists
    if (!fs.existsSync(this.bootstrapDir)) {
      fs.mkdirSync(this.bootstrapDir, { recursive: true });
    }

    // Copy from project dir if runtime dir is empty
    if (projectBootstrapDir && fs.existsSync(projectBootstrapDir)) {
      const runtimeFiles = fs.readdirSync(this.bootstrapDir).filter(f => f.endsWith(".md"));
      if (runtimeFiles.length === 0) {
        this.log.gateway("Kopiere Bootstrap-Dateien in Runtime-Verzeichnis...");
        const sourceFiles = fs.readdirSync(projectBootstrapDir).filter(f => f.endsWith(".md"));
        for (const file of sourceFiles) {
          const src = path.join(projectBootstrapDir, file);
          const dst = path.join(this.bootstrapDir, file);
          fs.copyFileSync(src, dst);
        }
        this.log.ok(`${sourceFiles.length} Bootstrap-Dateien kopiert`);

        // Replace template variables with config values
        if (config) {
          this.personalizeBootstrap(config);
        }
      }
    }

    // Load all files
    this.loadAllFiles();
  }

  /** Check if this is the first start (bootstrap not yet completed) */
  isFirstStart(): boolean {
    return !this.state.bootstrapCompleted;
  }

  /** Mark bootstrap as completed */
  markCompleted(): void {
    this.state.bootstrapCompleted = true;
    this.state.firstStartDate = this.state.firstStartDate ?? new Date().toISOString();
    this.saveState();
    this.log.ok("Bootstrap als abgeschlossen markiert");
  }

  /** Build the full system prompt from bootstrap files */
  buildSystemPrompt(): string {
    const sections: string[] = [];

    // Always include identity, soul, tools, rules
    if (this.files.identity) {
      sections.push("== IDENTITY ==\n" + this.files.identity);
    }
    if (this.files.soul) {
      sections.push("== SOUL ==\n" + this.files.soul);
    }
    if (this.files.tools) {
      sections.push("== TOOLS ==\n" + this.files.tools);
    }
    if (this.files.rules) {
      sections.push("== RULES ==\n" + this.files.rules);
    }
    if (this.files.owner) {
      sections.push("== OWNER ==\n" + this.files.owner);
    }
    if (this.files.services) {
      sections.push("== SERVICES ==\n" + this.files.services);
    }
    if (this.files.goals) {
      sections.push("== GOALS ==\n" + this.files.goals);
    }

    // Include bootstrap instructions only on first start
    if (this.isFirstStart() && this.files.bootstrap) {
      sections.push("== BOOTSTRAP (ERSTER START) ==\n" + this.files.bootstrap);
    }

    return sections.join("\n\n");
  }

  /** Build a compact system prompt (for execution tasks – less context) */
  buildCompactPrompt(): string {
    const sections: string[] = [];

    if (this.files.identity) {
      // Only first 3 lines of identity
      const lines = this.files.identity.split("\n").slice(0, 10);
      sections.push(lines.join("\n"));
    }
    if (this.files.rules) {
      // Only the absolute rules
      const rulesSection = this.files.rules.split("## 💰")[0] ?? "";
      sections.push(rulesSection.trim());
    }

    return sections.join("\n\n");
  }

  /** Get a specific bootstrap file content */
  getFile(name: keyof BootstrapFiles): string | undefined {
    return this.files[name];
  }

  /** Update a bootstrap file (the agent can update GOALS.md, OWNER.md) */
  updateFile(name: string, content: string): void {
    const allowed = ["GOALS.md", "OWNER.md"];
    if (!allowed.includes(name)) {
      this.log.error(`Bootstrap-Datei ${name} darf nicht vom Agenten geändert werden`);
      return;
    }

    const filePath = path.join(this.bootstrapDir, name);
    fs.writeFileSync(filePath, content, "utf-8");

    // Update internal cache
    const key = name.replace(".md", "").toLowerCase() as keyof BootstrapFiles;
    this.files[key] = content;

    this.log.ok(`Bootstrap-Datei ${name} aktualisiert`);
  }

  /** Get state */
  getState(): BootstrapState {
    return { ...this.state };
  }

  /** Replace {{PLACEHOLDER}} variables in all bootstrap files with config values */
  private personalizeBootstrap(config: CashClawConfig): void {
    const vars: Record<string, string> = {
      OWNER_NAME: config.agent?.owner ?? "Operator",
      OWNER_EMAIL: config.agent?.email ?? "",
      OWNER_LOCATION: "Nicht angegeben",
      OWNER_TIMEZONE: "Europe/Berlin",
      OWNER_CURRENCY: config.agent?.currency ?? "EUR",
      DAILY_BUDGET: String(config.financeLimits?.dailyApiBudgetUsd ?? 5),
      TELEGRAM_CHAT_ID: config.platform?.telegram?.operatorChatId ?? "",
      AGENT_NAME: config.agent?.name ?? "Cash-Claw",
    };

    const mdFiles = fs.readdirSync(this.bootstrapDir).filter(f => f.endsWith(".md"));
    let replacements = 0;

    for (const file of mdFiles) {
      const filePath = path.join(this.bootstrapDir, file);
      let content = fs.readFileSync(filePath, "utf-8");
      let changed = false;

      for (const [key, value] of Object.entries(vars)) {
        const placeholder = `{{${key}}}`;
        if (content.includes(placeholder)) {
          content = content.replaceAll(placeholder, value);
          changed = true;
          replacements++;
        }
      }

      if (changed) {
        fs.writeFileSync(filePath, content, "utf-8");
      }
    }

    if (replacements > 0) {
      this.log.ok(`Auto-Bootstrap: ${replacements} Platzhalter mit Config-Werten ersetzt`);
    }
  }

  // ── Private ──────────────────────────────────────────────────

  private loadAllFiles(): void {
    const fileMap: Record<string, keyof BootstrapFiles> = {
      "IDENTITY.md": "identity",
      "SOUL.md": "soul",
      "TOOLS.md": "tools",
      "RULES.md": "rules",
      "OWNER.md": "owner",
      "SERVICES.md": "services",
      "GOALS.md": "goals",
      "BOOTSTRAP.md": "bootstrap",
    };

    const loaded: string[] = [];
    let totalSize = 0;

    for (const [filename, key] of Object.entries(fileMap)) {
      const filePath = path.join(this.bootstrapDir, filename);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        this.files[key] = content;
        loaded.push(filename);
        totalSize += content.length;
      }
    }

    this.state.filesLoaded = loaded;
    this.state.totalSize = totalSize;

    this.log.ok(`Bootstrap: ${loaded.length} Dateien geladen (${(totalSize / 1024).toFixed(1)}KB)`);
  }

  private loadState(): BootstrapState {
    try {
      if (fs.existsSync(this.stateFile)) {
        return JSON.parse(fs.readFileSync(this.stateFile, "utf-8"));
      }
    } catch {
      // ignore
    }
    return {
      bootstrapCompleted: false,
      firstStartDate: null,
      filesLoaded: [],
      totalSize: 0,
    };
  }

  private saveState(): void {
    const dir = path.dirname(this.stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), "utf-8");
  }
}
