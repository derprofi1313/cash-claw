// GatewayServer â€“ Main orchestrator that wires Config + LLM + Telegram + AEL + Tools

import path from "node:path";
import { ConfigBridge } from "../config/ConfigBridge.js";
import { DebugConsole } from "../cli/DebugConsole.js";
import { GatewayLogger } from "./GatewayLogger.js";
import { LLMAdapter } from "./LLMAdapter.js";
import { TelegramAdapter } from "./TelegramAdapter.js";
import { AgentRuntime } from "./AgentRuntime.js";
import { GogAdapter } from "./GogAdapter.js";
import { BrowserAdapter } from "./BrowserAdapter.js";
import { LearningSystem } from "./LearningSystem.js";
import { SubAgentManager } from "./SubAgentManager.js";
import { BootstrapManager } from "./BootstrapManager.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { CostTracker } from "./CostTracker.js";
import { SessionManager } from "./SessionManager.js";
import { DailyReflection } from "./DailyReflection.js";
import { MonetizationSkills } from "./MonetizationSkills.js";
import { HttpGateway } from "./HttpGateway.js";
import { OpenClawAdapter } from "./OpenClawAdapter.js";

// Tool factories
import { FsReadTool, FsWriteTool, FsListTool, FsExistsTool, FsMkdirTool } from "../tools/fs/FsTools.js";
import { createTelegramTools } from "../tools/telegram/TelegramTools.js";
import { createGogTools } from "../tools/gog/GogTools.js";
import { createBrowserTools } from "../tools/browser/BrowserTools.js";
import { createLearningTools } from "../tools/learning/LearningTools.js";
import { createStripeTools } from "../tools/stripe/StripeTools.js";
import { createSubAgentTool, createLlmTool } from "../tools/agent/AgentTools.js";
import { CronManager } from "../tools/cron/CronTools.js";
import { createOpenClawTools } from "../tools/openclaw/OpenClawTools.js";

export interface GatewayOptions {
  port: number;
  debug: boolean;
}

export class GatewayServer {
  private bridge: ConfigBridge;
  private console: DebugConsole;
  private log!: GatewayLogger;
  private llm!: LLMAdapter;
  private telegram: TelegramAdapter | null = null;
  private gog: GogAdapter | null = null;
  private browser: BrowserAdapter | null = null;
  private openclaw: OpenClawAdapter | null = null;
  private learning!: LearningSystem;
  private subAgents!: SubAgentManager;
  private bootstrap!: BootstrapManager;
  private registry!: ToolRegistry;
  private costTracker!: CostTracker;
  private session!: SessionManager;
  private reflection!: DailyReflection;
  private skills!: MonetizationSkills;
  private runtime!: AgentRuntime;
  private httpGateway!: HttpGateway;
  private shutdownRequested = false;

  constructor(private opts: GatewayOptions) {
    this.bridge = new ConfigBridge();
    this.console = new DebugConsole(opts.debug);
    this.console.attach(this.bridge);
  }

  async start(): Promise<void> {
    this.log = new GatewayLogger(this.bridge, this.opts.debug);

    // â”€â”€ 1. Print banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this.opts.debug) {
      this.printBanner();
    }

    // â”€â”€ 2. Load config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.log.gateway("Lade Konfiguration...");
    const configPassword = process.env["CASHCLAW_CONFIG_PASSWORD"] ?? undefined;
    this.bridge.load(configPassword);
    const config = this.bridge.getConfig();

    if (!config.setupComplete) {
      this.log.error("Setup nicht abgeschlossen! FÃ¼hre zuerst 'cashclaw onboard' aus.");
      process.exit(1);
    }

    const agentName = config.agent?.name ?? "Cash-Claw";
    const owner = config.agent?.owner ?? "Operator";

    // Use config.server.port if CLI didn't specify one (default 18789)
    if (config.server?.port && this.opts.port === 18789) {
      this.opts.port = config.server.port;
    }

    this.log.ok(`Config geladen: ${agentName} (${owner})`);
    this.log.config(`LLM: ${config.llm.provider}/${config.llm.model}`);
    this.log.config(`Plattform: ${config.platform.type}`);
    this.log.config(`Kategorien: ${Object.entries(config.categories).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
    this.log.config(`Zeitplan: ${config.schedule?.activeFrom ?? "00:00"}â€“${config.schedule?.activeTo ?? "24:00"}, max ${config.schedule?.maxActionsPerDay ?? 50} Aktionen/Tag`);
    this.log.config(`API-Budget: $${config.financeLimits?.dailyApiBudgetUsd ?? 5}/Tag`);

    if (config.services) {
      const enabledCount = Object.values(config.services).filter(s => s.enabled).length;
      this.log.config(`Services: ${enabledCount} aktiv`);
    }

    if (config.docker?.enabled) {
      this.log.gateway("âš ï¸ Docker-Sandboxing aktiviert, aber noch nicht erzwungen â€“ Tools laufen unsandboxed");
    }

    // â”€â”€ 3. Initialize LLM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.log.gateway("Initialisiere LLM...");
    this.llm = new LLMAdapter(config.llm, this.log);
    const llmOk = await this.llm.testConnection();
    if (!llmOk) {
      this.log.error("LLM-Verbindung fehlgeschlagen. Gateway startet trotzdem, aber AEL-Zyklen werden fehlschlagen.");
    }

    // â”€â”€ 4. Prepare Telegram â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Create adapter now but defer start() until runtime is ready (step 12b)
    if (config.platform.telegram?.botToken) {
      this.log.gateway("Initialisiere Telegram Bot...");
      this.telegram = new TelegramAdapter(
        config,
        this.log,
        () => this.runtime?.getState() ?? { running: false, paused: false, actionsToday: 0, costToday: 0, currentTask: null, lastPlanTime: null, cycleCount: 0, tasksCompleted: [], startedAt: null },
        (cmd) => this.handleTelegramCommand(cmd),
        async (message) => this.handleTelegramMessage(message),
      );
    } else {
      this.log.gateway("Telegram nicht konfiguriert â€“ Ã¼bersprungen");
    }

    // â”€â”€ 5. Initialize gog (Google Workspace CLI) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (config.gog?.account) {
      this.log.gateway("Initialisiere gog CLI (Google Workspace)...");
      this.gog = new GogAdapter(
        { account: config.gog.account, enabled: config.gog.enabled ?? true },
        this.log,
      );
      await this.gog.testConnection();
    } else {
      this.log.gateway("gog nicht konfiguriert â€“ Ã¼bersprungen");
    }

    // â”€â”€ 6. Initialize Browser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.log.gateway("PrÃ¼fe agent-browser...");
    this.browser = new BrowserAdapter(this.log);
    const browserOk = await this.browser.isInstalled();
    if (!browserOk) {
      this.log.gateway("Browser-Automatisierung nicht verfÃ¼gbar (npm i -g agent-browser)");
      this.browser = null;
    }

    // â”€â”€ 6b. Initialize OpenClaw Skill adapter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.openclaw = new OpenClawAdapter(config, {
      info: (message) => this.log.gateway(message),
      warn: (message) => this.log.gateway(`OpenClaw: ${message}`),
      error: (message) => this.log.error(`OpenClaw: ${message}`),
    });
    const openclawWorkspace = this.openclaw.getWorkspaceRoot();
    if (openclawWorkspace) {
      this.log.gateway(`OpenClaw-Workspace erkannt: ${openclawWorkspace}`);
      this.log.gateway(`OpenClaw Install-Ziel: ${this.openclaw.getInstallRoot()}`);
    } else {
      this.log.gateway("Kein OpenClaw-Workspace erkannt â€“ lokale Skill-Suche ist eingeschrÃ¤nkt");
    }

    // â”€â”€ 7. Initialize Learning System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.log.gateway("Initialisiere Lernsystem...");
    this.learning = new LearningSystem(this.log);
    this.learning.init();

    // â”€â”€ 8. Initialize Sub-Agent Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.subAgents = new SubAgentManager(this.llm, this.log);

    // â”€â”€ 9. Initialize Bootstrap Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.log.gateway("Lade Bootstrap-Dateien...");
    this.bootstrap = new BootstrapManager(this.log);
    // Resolve project bootstrap dir (relative to this file's compiled location)
    const projectBootstrapDir = path.resolve(
      import.meta.dirname ?? ".",
      "..",
      "..",
      "bootstrap",
    );
    this.bootstrap.init(projectBootstrapDir, config);

    // â”€â”€ 10. Initialize Tool Registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.registry = new ToolRegistry(this.log);

    // Register filesystem tools
    this.registry.registerAll([FsReadTool, FsWriteTool, FsListTool, FsExistsTool, FsMkdirTool]);

    // Register adapter-bound tools
    this.registry.registerAll(createTelegramTools(this.telegram));
    this.registry.registerAll(createGogTools(this.gog));
    this.registry.registerAll(createBrowserTools(this.browser));
    this.registry.registerAll(createLearningTools(this.learning));
    this.registry.registerAll(createStripeTools(config.stripe?.secretKey ?? null));
    this.registry.registerAll(createOpenClawTools(this.openclaw));

    // Register agent tools
    this.registry.register(createSubAgentTool(this.subAgents));
    this.registry.register(createLlmTool(this.llm));

    // Register cron tools
    const cronManager = new CronManager(this.log);
    this.registry.registerAll(cronManager.createTools());

    this.log.ok(`ðŸ”§ ${this.registry.getAll().length} Tools registriert`);

    // â”€â”€ 10b. Initialize Cost Tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const dailyBudget = config.financeLimits?.dailyApiBudgetUsd ?? 5;
    this.costTracker = new CostTracker(this.log, dailyBudget);

    // â”€â”€ 10c. Initialize Session Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.session = new SessionManager(this.log);
    const resumed = this.session.resumeLatest();
    if (!resumed) {
      this.log.gateway("Neue Session gestartet");
    }

    // â”€â”€ 11. Initialize Monetization Skills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.skills = new MonetizationSkills(this.log, this.registry, this.llm);

    // â”€â”€ 12. Build Runtime + Start Telegram + Start AEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Runtime wird vor Telegram-Polling erstellt, damit alle Nachrichten sofort am LLM landen.
    this.runtime = new AgentRuntime(
      config, this.llm, this.telegram, this.log,
      this.registry, this.costTracker, this.session,
      this.bootstrap, this.learning, this.skills, this.openclaw,
    );

    if (this.telegram) {
      await this.telegram.start();
    }

    this.log.gateway("Starte Autonomous Execution Loop (AEL)...");
    await this.runtime.start();

    // â”€â”€ 13. Start Daily Reflection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.log.gateway("Starte Tagesreflexion-Scheduler...");
    this.reflection = new DailyReflection(
      config, this.llm, this.telegram, this.learning, this.log,
      this.bootstrap,
    );
    this.reflection.start();

    // â”€â”€ 14. Start HTTP Gateway â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.httpGateway = new HttpGateway(
      this.opts.port, this.log, this.runtime,
      this.costTracker, this.session, this.registry, this.skills,
      this.reflection, config.stripe?.webhookSecret ?? null,
    );
    this.httpGateway.start();

    // Wire runtime events to WebSocket broadcast
    this.runtime.onEvent((event) => {
      const { type, ...payload } = event;
      this.httpGateway.broadcast(type as import("./protocol/types.js").GatewayEvent, payload as Record<string, unknown>);
    });

    // â”€â”€ 15. Register shutdown handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const shutdown = () => this.stop();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    this.log.ok(`\nðŸ¦€ Cash-Claw Gateway gestartet`);
    this.log.ok(`   Agent: ${agentName} | LLM: ${config.llm.provider}/${config.llm.model}`);
    const features = [
      this.gog?.enabled ? "Gog" : null,
      this.browser ? "Browser" : null,
      this.openclaw ? "OpenClaw-Skills" : null,
      "Learning",
      "Sub-Agents",
      "Reflection",
      `${this.registry.getAll().length} Tools`,
      `${this.skills.getSkills().length} Skills`,
    ].filter(Boolean).join(", ");
    this.log.ok(`   Features: ${features}`);
    this.log.ok(`   Dashboard: http://127.0.0.1:${this.opts.port}/`);
    this.log.ok(`   DrÃ¼cke Ctrl+C zum Beenden\n`);

    // Always print startup banner to console (even without --debug)
    const GREEN = "\x1b[32m";
    const CYAN = "\x1b[36m";
    const RESET = "\x1b[0m";
    console.log("");
    console.log(`${GREEN}🦀 Cash-Claw Gateway gestartet${RESET}`);
    console.log(`   Agent: ${agentName} | LLM: ${config.llm.provider}/${config.llm.model}`);
    console.log(`   Features: ${features}`);
    console.log(`   ${CYAN}Dashboard: http://127.0.0.1:${this.opts.port}/${RESET}`);
    console.log(`   Drücke Ctrl+C zum Beenden`);
    console.log("");
  }

  async stop(): Promise<void> {
    if (this.shutdownRequested) return;
    this.shutdownRequested = true;

    this.log.gateway("\nðŸ›‘ Gateway wird heruntergefahren...");

    // Stop AEL loop
    if (this.runtime) {
      this.runtime.stop();
    }

    // Stop reflection scheduler
    if (this.reflection) {
      this.reflection.stop();
    }

    // Save session and costs
    if (this.session) {
      this.session.saveTranscript();
      this.session.save();
    }
    if (this.costTracker) {
      this.costTracker.saveSession();
    }

    // Update runtime stats in config
    try {
      const cfg = this.bridge.getConfig();
      const state = this.runtime?.getState();
      if (state) {
        cfg.stats = {
          total_missions: (cfg.stats?.total_missions ?? 0) + state.actionsToday,
          completed_missions: (cfg.stats?.completed_missions ?? 0) + state.tasksCompleted.filter(t => t.success).length,
          total_earned: cfg.stats?.total_earned ?? 0,
        };
        this.bridge.save();
      }
    } catch { /* ignore stats save errors */ }

    // Stop HTTP Gateway
    if (this.httpGateway) {
      this.httpGateway.stop();
    }

    // Stop Telegram
    if (this.telegram) {
      await this.telegram.sendToOperator("ðŸ›‘ Cash-Claw Gateway gestoppt.");
      this.telegram.stop();
    }

    this.log.ok("Gateway sauber beendet.");

    // Give logs time to flush
    setTimeout(() => process.exit(0), 500);
  }

  private async handleTelegramMessage(text: string): Promise<string> {
    if (this.runtime) {
      try {
        return await this.runtime.handleOperatorMessage(text);
      } catch (err) {
        this.log.error(`Runtime-Chat fehlgeschlagen, nutze LLM-Fallback: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (this.llm) {
      try {
        const response = await this.llm.send(
          [{ role: "user", content: text }],
          "Du bist der Cash-Claw Mitarbeiter. Die Runtime startet gerade noch. Antworte hilfreich und kurz.",
        );
        return `${response.text}\n\nHinweis: Runtime startet noch, volle Agentensteuerung folgt gleich.`;
      } catch (err) {
        this.log.error(`Telegram Fallback-Chat fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return "Gateway startet noch. Bitte in ein paar Sekunden erneut schreiben.";
  }

  private handleTelegramCommand(cmd: string): void {
    if (!this.runtime) {
      this.log.gateway(`Telegram-Kommando "${cmd}" ignoriert: Runtime startet noch`);
      return;
    }

    switch (cmd) {
      case "pause":
        this.runtime.pause();
        break;
      case "resume":
        this.runtime.resume();
        break;
      case "stop":
        this.stop();
        break;
      case "plan":
        this.runtime.triggerCycle();
        break;
      case "reflect":
        this.reflection.runNow().catch(err => {
          this.log.error(`Reflexion fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
        });
        break;
    }
  }

  private printBanner(): void {
    const CYAN = "\x1b[36m";
    const GREEN = "\x1b[32m";
    const RESET = "\x1b[0m";
    const DIM = "\x1b[2m";

    console.log("");
    console.log(`${GREEN}â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—${RESET}`);
    console.log(`${GREEN}â•‘                                                      â•‘${RESET}`);
    console.log(`${GREEN}â•‘   ðŸ¦€  ${CYAN}Cash-Claw Gateway${GREEN}                              â•‘${RESET}`);
    console.log(`${GREEN}â•‘   ${DIM}Autonomous Execution Loop â€“ Debug Mode${RESET}${GREEN}            â•‘${RESET}`);
    console.log(`${GREEN}â•‘                                                      â•‘${RESET}`);
    console.log(`${GREEN}â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•${RESET}`);
    console.log("");
  }
}


