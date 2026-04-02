// AgentRuntime â€“ Autonomous Execution Loop (AEL) v2
// Multi-turn Query Loop: PLAN â†’ QUERY-LOOP (LLM â†” Tools) â†’ REVIEW â†’ LEARN
// Inspired by Claude Code's query engine pattern

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CashClawConfig } from "../config/types.js";
import type { GatewayLogger } from "./GatewayLogger.js";
import type { LLMAdapter } from "./LLMAdapter.js";
import type { TelegramAdapter } from "./TelegramAdapter.js";
import type { BootstrapManager } from "./BootstrapManager.js";
import type { LearningSystem } from "./LearningSystem.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { CostTracker } from "./CostTracker.js";
import type { SessionManager } from "./SessionManager.js";
import type { MonetizationSkills } from "./MonetizationSkills.js";
import type { OpenClawAdapter } from "./OpenClawAdapter.js";
import { QueryLoop } from "./QueryLoop.js";
import type { QueryResult, QueryProgressCallback } from "./QueryLoop.js";
import type { ToolContext, PermissionMode } from "../tools/Tool.js";
import type { AgentTask, AgentPlan, TaskResult, AgentState } from "./types.js";

export type RuntimeEventCallback = (event: { type: string; [key: string]: unknown }) => void;

interface StartupMarkdownScanSummary {
  roots: string[];
  filesRead: number;
  totalBytes: number;
  readErrors: number;
  sampleFiles: string[];
}

interface OnboardingGateState {
  enabled: boolean;
  unlocked: boolean;
  minMessages: number;
  minTotalChars: number;
  totalUserMessages: number;
  totalUserChars: number;
  startupPromptSent: boolean;
  lastDecisionAt: Date | null;
  missingTools: string[];
}

interface OperatorChatDecision {
  reply: string;
  readyToStart: boolean;
  rationale: string;
  missingTools: string[];
  correctionLearning: string;
  emailApproved: boolean;
  needsSkill: string;
}

interface HourlyWakeDecision {
  operatorUpdate: string;
  triggerCycle: boolean;
  askNewIdeas: string;
}

const HOURLY_GATEWAY_WAKE_PROMPT = [
  "Gateway Wakeup: Du wurdest nach 1 Stunde proaktiv geweckt.",
  "Prüfe zuerst, was bereits erledigt ist und wo Pipeline/Antworten fehlen.",
  "Wenn keine Antworten auf Outreach sichtbar sind: zusätzliche Firmen recherchieren und neue, individuelle Ansprache vorbereiten.",
  "Frage den Operator auch nach weiteren Ideen, wie noch mehr Geld verdient werden kann.",
].join("\n");

export class AgentRuntime {
  private state: AgentState;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private configDir: string;
  private cycleRunning = false;
  private queryLoop: QueryLoop;
  private eventListeners: RuntimeEventCallback[] = [];
  private onboardingGate: OnboardingGateState;
  private hourlyWakeTimer: ReturnType<typeof setInterval> | null = null;
  private operatorEmailApproval = false;

  constructor(
    private config: CashClawConfig,
    private llm: LLMAdapter,
    private telegram: TelegramAdapter | null,
    private log: GatewayLogger,
    private registry: ToolRegistry,
    private costTracker: CostTracker,
    private session: SessionManager,
    private bootstrap: BootstrapManager,
    private learning: LearningSystem,
    private skills: MonetizationSkills | null = null,
    private openclaw: OpenClawAdapter | null = null,
  ) {
    this.configDir = path.join(os.homedir(), ".cashclaw");
    this.queryLoop = new QueryLoop(log, llm, registry, costTracker, session);
    this.state = {
      running: false,
      paused: false,
      actionsToday: 0,
      costToday: 0,
      currentTask: null,
      lastPlanTime: null,
      cycleCount: 0,
      tasksCompleted: [],
      startedAt: null,
    };
    this.onboardingGate = {
      enabled: this.telegram !== null,
      unlocked: false,
      minMessages: 3,
      minTotalChars: 280,
      totalUserMessages: 0,
      totalUserChars: 0,
      startupPromptSent: false,
      lastDecisionAt: null,
      missingTools: [],
    };
  }

  /** Start the AEL loop */
  async start(): Promise<void> {
    const startupScan = this.scanMarkdownFilesOnStartup();
    await this.notifyOperatorStartupScan(startupScan);
    await this.sendOnboardingPromptIfNeeded();

    this.state.running = true;
    this.state.startedAt = new Date();
    this.log.gateway("AEL Loop gestartet");

    // Run first cycle after a short delay
    setTimeout(() => {
      void this.runCycle();
    }, 2000);

    // Then run at the configured interval
    const intervalMs = (this.config.schedule?.planningIntervalMinutes ?? 15) * 60 * 1000;
    this.log.gateway(`NÃ¤chster Zyklus in ${this.config.schedule?.planningIntervalMinutes ?? 15} Minuten`);
    this.intervalId = setInterval(() => this.runCycle(), intervalMs);

    // Hourly proactive wake-up loop
    this.hourlyWakeTimer = setInterval(() => {
      void this.runHourlyWakeup();
    }, 60 * 60 * 1000);
  }

  /** Stop the AEL loop */
  stop(): void {
    this.state.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.hourlyWakeTimer) {
      clearInterval(this.hourlyWakeTimer);
      this.hourlyWakeTimer = null;
    }
    // Persist session and costs on shutdown
    this.session.save();
    this.costTracker.saveSession();
    this.log.gateway("AEL Loop gestoppt");
  }

  pause(): void {
    this.state.paused = true;
    this.log.gateway("â¸ Agent pausiert");
  }

  resume(): void {
    this.state.paused = false;
    this.log.gateway("â–¶ï¸ Agent fortgesetzt");
  }

  /** Trigger an immediate planning cycle */
  triggerCycle(): void {
    if (this.onboardingGate.enabled && !this.onboardingGate.unlocked) {
      this.log.gateway("Autonomer Zyklus gesperrt: Warte auf ausreichendes Briefing vom Operator");
      return;
    }
    if (this.cycleRunning) {
      this.log.gateway("Zyklus lÃ¤uft bereits â€“ Ã¼bersprungen");
      return;
    }
    void this.runCycle();
  }

  /** Handle free-text chat input from the operator */
  async handleOperatorMessage(text: string): Promise<string> {
    const normalized = text.trim();
    if (!normalized) {
      return "Bitte sende eine konkrete Nachricht, damit ich sinnvoll antworten kann.";
    }

    this.trackOnboardingInput(normalized);

    const directSkillReply = await this.tryHandleSkillChatShortcut(normalized);
    if (directSkillReply) {
      this.session.addMessage({ role: "user", content: normalized });
      this.session.addMessage({ role: "assistant", content: directSkillReply });
      return directSkillReply;
    }

    const systemPrompt = this.buildOperatorChatSystemPrompt();
    const messages = this.buildOperatorChatMessages(normalized);

    try {
      const response = await this.llm.send(messages, systemPrompt);
      this.state.costToday += response.costUsd;
      this.costTracker.addLlmCost(
        this.llm.getModel(),
        response.tokensUsed.prompt,
        response.tokensUsed.completion,
        response.costUsd,
      );

      const decision = this.parseOperatorChatDecision(response.text);
      this.onboardingGate.missingTools = decision.missingTools;

      if (decision.correctionLearning) {
        this.learning.logLearning("operator-feedback", decision.correctionLearning);
      }

      if (decision.emailApproved) {
        this.operatorEmailApproval = true;
        this.log.gateway("Operator hat E-Mail-Versand freigegeben");
      }

      if (decision.needsSkill) {
        this.learning.logFeature(
          `Skill benoetigt: ${decision.needsSkill}`,
          "Vom Operator-Chat erkannt (Umsetzung aktuell nicht robust ohne zusätzlichen Skill)",
        );
      }

      this.session.addMessage({ role: "user", content: normalized });
      this.session.addMessage({ role: "assistant", content: decision.reply });

      const shouldUnlock = !this.onboardingGate.unlocked
        && this.onboardingGate.missingTools.length === 0
        && (decision.readyToStart || this.isOnboardingThresholdReached());

      let reply = decision.reply;
      if (decision.missingTools.length > 0) {
        reply += `\n\nMir fehlen noch folgende Tools/Zugänge:\n- ${decision.missingTools.join("\n- ")}`;
      }

      if (decision.needsSkill) {
        const installNote = await this.tryAutoProvisionNeededSkill(decision.needsSkill);
        if (installNote) {
          reply += `\n\nSkill-Update: ${installNote}`;
        }
      }

      if (shouldUnlock) {
        await this.unlockAutonomousWork(decision.rationale || "Kontext ausreichend");
        reply += "\n\nUpdate: Ich habe jetzt genug Kontext und starte den ersten Arbeitszyklus.";
      }

      return reply;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`Chat-Antwort fehlgeschlagen: ${msg}`);
      return "Ich konnte gerade nicht sauber antworten. Bitte sende die letzte Nachricht noch einmal.";
    }
  }

  private async tryHandleSkillChatShortcut(text: string): Promise<string | null> {
    if (!this.openclaw) {
      return null;
    }

    const lower = text.toLowerCase();
    if (this.isSkillListRequest(lower)) {
      const query = this.extractSkillQuery(lower);
      const available = this.openclaw.listAvailableSkills(query);
      const installed = this.openclaw.listInstalledSkills(query);
      return this.formatSkillListReply(available, installed, query);
    }

    if (this.isSkillInstallRequest(lower)) {
      const skillName = this.extractSkillNameFromText(text);
      if (!skillName) {
        return "Bitte nenne den Skill-Namen, z.B. 'installiere skill clawhub'.";
      }

      const result = this.openclaw.installSkill(skillName, {
        source: "auto",
        allowClawhubFallback: true,
      });

      if (!result.success) {
        this.learning.logFeature(`Skill-Installation fehlgeschlagen: ${skillName}`, result.message);
        return `Skill-Installation fehlgeschlagen: ${result.message}`;
      }

      const walkthrough = this.buildSkillWalkthrough(skillName);
      const lines = [
        `${result.message}`,
        result.installedPath ? `Installiert unter: ${result.installedPath}` : "",
        "",
        walkthrough,
      ].filter(Boolean);
      return lines.join("\n");
    }

    if (this.isSkillWalkthroughRequest(lower)) {
      const skillName = this.extractSkillNameFromText(text);
      if (!skillName) {
        return "Bitte nenne den Skill fuer den Durchgang, z.B. 'zeige mir den skill gog'.";
      }
      return this.buildSkillWalkthrough(skillName);
    }

    return null;
  }

  private async tryAutoProvisionNeededSkill(needsSkill: string): Promise<string | null> {
    const requestedSkill = needsSkill.trim();
    if (!requestedSkill) return null;

    if (!this.openclaw) {
      return "OpenClaw-Skilladapter ist nicht aktiv. Ich habe den Bedarf als Feature notiert.";
    }

    const result = this.openclaw.installSkill(requestedSkill, {
      source: "auto",
      allowClawhubFallback: true,
    });

    if (!result.success) {
      return result.message;
    }

    this.learning.logLearning(
      "skills",
      `Benötigten Skill automatisch bereitgestellt: ${result.skill} (${result.sourceType ?? "unbekannt"})`,
    );

    return `${result.message}${result.installedPath ? ` Pfad: ${result.installedPath}` : ""}`;
  }

  private isSkillListRequest(lower: string): boolean {
    const hasSkillWord = /\bskill\b|\bskills\b/.test(lower);
    const hasListIntent = /\bliste\b|\blist\b|\bzeigen\b|\bwelche\b|\bavailable\b|\bverfuegbar\b/.test(lower);
    return hasSkillWord && hasListIntent;
  }

  private isSkillInstallRequest(lower: string): boolean {
    const hasInstallIntent = /\binstall\b|\binstalliere\b|\binstaliere\b|\binsterliere\b/.test(lower);
    const hasSkillWord = /\bskill\b|\bskills\b|\bclawhub\b/.test(lower);
    return hasInstallIntent && hasSkillWord;
  }

  private isSkillWalkthroughRequest(lower: string): boolean {
    const hasSkillWord = /\bskill\b|\bskills\b/.test(lower);
    const hasWalkIntent = /\bdurch\b|\bdurchgehen\b|\berklaer\b|\berklär\b|\bguide\b|\bshow\b/.test(lower);
    return hasSkillWord && hasWalkIntent;
  }

  private extractSkillQuery(lower: string): string {
    const q = lower
      .replace(/\bskills?\b/g, "")
      .replace(/\bliste\b|\blist\b|\bzeigen\b|\bwelche\b|\bavailable\b|\bverfuegbar\b/g, "")
      .trim();
    return q;
  }

  private extractSkillNameFromText(text: string): string | null {
    if (!this.openclaw) return null;

    const lower = text.toLowerCase();
    const knownSkills = [
      ...this.openclaw.listInstalledSkills(),
      ...this.openclaw.listAvailableSkills(),
    ];

    const directMatch = knownSkills.find(skill => lower.includes(skill.id.toLowerCase()));
    if (directMatch) {
      return directMatch.id;
    }

    const patterns = [
      /\bskill(?:s)?\s+([a-z0-9][a-z0-9-]{1,80})\b/i,
      /\binstall(?:iere|ier|)\s+([a-z0-9][a-z0-9-]{1,80})\b/i,
      /\b([a-z0-9][a-z0-9-]{1,80})\s+skill\b/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const candidate = match?.[1]?.trim();
      if (!candidate) continue;
      if (["skill", "skills", "den", "der", "die"].includes(candidate.toLowerCase())) continue;
      return candidate;
    }

    return null;
  }

  private formatSkillListReply(
    available: Array<{ id: string; sourceType: string }>,
    installed: Array<{ id: string; sourceType: string }>,
    query: string,
  ): string {
    const lines: string[] = [];
    lines.push(`Skill-Status${query ? ` fuer '${query}'` : ""}:`);
    lines.push(`- Verfuegbar: ${available.length}`);
    lines.push(`- Installiert: ${installed.length}`);
    lines.push("");

    if (installed.length > 0) {
      lines.push("Installierte Skills:");
      for (const skill of installed.slice(0, 12)) {
        lines.push(`- ${skill.id}`);
      }
      if (installed.length > 12) {
        lines.push(`- ... und ${installed.length - 12} weitere`);
      }
      lines.push("");
    }

    if (available.length > 0) {
      lines.push("Verfuegbare Skills:");
      for (const skill of available.slice(0, 12)) {
        lines.push(`- ${skill.id} (${skill.sourceType})`);
      }
      if (available.length > 12) {
        lines.push(`- ... und ${available.length - 12} weitere`);
      }
    } else if (installed.length === 0) {
      lines.push("Ich habe aktuell keine passenden Skills gefunden.");
    }

    lines.push("");
    lines.push("Du kannst direkt schreiben: 'installiere skill <name>'.");
    return lines.join("\n");
  }

  private buildSkillWalkthrough(skillName: string): string {
    if (!this.openclaw) {
      return "OpenClaw-Skills sind aktuell nicht verfuegbar.";
    }

    const data = this.openclaw.readSkillMarkdown(skillName, true);
    if (!data) {
      return `Ich konnte SKILL.md fuer '${skillName}' nicht lesen.`;
    }

    const title = this.extractFrontmatterValue(data.content, "name") ?? data.skill.id;
    const description = this.extractFrontmatterValue(data.content, "description") ?? "Keine Beschreibung im Frontmatter.";
    const commands = this.extractShellCommands(data.content).slice(0, 4);

    const lines = [
      `Skill-Durchgang: ${title}`,
      `Beschreibung: ${description}`,
      `Quelle: ${data.skill.sourceType}`,
      "",
      "Empfohlene ersten Schritte:",
    ];

    if (commands.length === 0) {
      lines.push("- SKILL.md lesen und die dort beschriebenen Schritte nacheinander ausfuehren.");
    } else {
      for (const cmd of commands) {
        lines.push(`- ${cmd}`);
      }
    }

    lines.push("");
    lines.push("Wenn du willst, setze ich den Skill jetzt direkt fuer deine aktuelle Aufgabe ein.");
    return lines.join("\n");
  }

  private extractFrontmatterValue(markdown: string, key: string): string | null {
    const fm = markdown.match(/^---\s*([\s\S]*?)\s*---/);
    if (!fm) return null;

    const pattern = new RegExp(`^${key}:\\s*(.+)$`, "im");
    const match = fm[1].match(pattern);
    if (!match?.[1]) return null;
    return match[1].trim().replace(/^["']|["']$/g, "");
  }

  private extractShellCommands(markdown: string): string[] {
    const blocks = [...markdown.matchAll(/```(?:bash|sh|shell)?\s*([\s\S]*?)```/g)];
    const commands: string[] = [];
    for (const block of blocks) {
      const content = block[1] ?? "";
      for (const line of content.split(/\r?\n/)) {
        const cmd = line.trim();
        if (!cmd) continue;
        if (cmd.startsWith("#")) continue;
        commands.push(cmd);
      }
    }
    return commands;
  }

  /** Register an event listener (used by HttpGateway for WebSocket broadcast) */
  onEvent(cb: RuntimeEventCallback): void {
    this.eventListeners.push(cb);
  }

  private emit(event: { type: string; [key: string]: unknown }): void {
    for (const cb of this.eventListeners) {
      try { cb(event); } catch { /* ignore listener errors */ }
    }
  }

  getState(): AgentState {
    return { ...this.state };
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  AEL MAIN LOOP
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  private async runCycle(): Promise<void> {
    if (!this.state.running || this.state.paused || this.cycleRunning) return;

    if (this.onboardingGate.enabled && !this.onboardingGate.unlocked) {
      this.log.gateway("Warte auf Operator-Briefing â€“ autonomer Zyklus bleibt gesperrt");
      return;
    }
    // Schedule guard: active hours
    if (!this.isInActiveHours()) {
      this.log.gateway("AuÃŸerhalb aktiver Stunden â€“ Zyklus Ã¼bersprungen");
      return;
    }

    // Budget guard
    const maxActions = this.config.schedule?.maxActionsPerDay ?? 50;
    if (this.state.actionsToday >= maxActions) {
      this.log.gateway(`Tageslimit erreicht (${this.state.actionsToday}/${maxActions}) â€“ Ã¼bersprungen`);
      return;
    }

    const apiBudget = this.config.financeLimits?.dailyApiBudgetUsd ?? 5;
    if (this.costTracker.isBudgetExceeded()) {
      this.log.gateway(`API-Budget aufgebraucht ($${this.costTracker.getTodayCost().toFixed(2)}/$${apiBudget}) â€“ Ã¼bersprungen`);
      return;
    }

    this.cycleRunning = true;
    this.state.cycleCount++;
    this.log.gateway(`\n${"â•".repeat(50)}`);
    this.log.gateway(`AEL ZYKLUS #${this.state.cycleCount}`);
    this.log.gateway(`${"â•".repeat(50)}`);
    this.emit({ type: "cycle_start", cycle: this.state.cycleCount });

    try {
      // â”€â”€ Phase 1: PLAN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const plan = await this.planPhase();
      if (!plan || plan.tasks.length === 0) {
        this.log.plan("Keine Aufgaben fÃ¼r diesen Zyklus");
        this.cycleRunning = false;
        return;
      }

      // â”€â”€ Phase 2: EXECUTE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      for (const task of plan.tasks) {
        if (this.state.actionsToday >= maxActions) {
          this.log.exec("Tageslimit erreicht â€“ restliche Tasks Ã¼bersprungen");
          break;
        }
        if (this.costTracker.isBudgetExceeded()) {
          this.log.exec("API-Budget aufgebraucht â€“ restliche Tasks Ã¼bersprungen");
          break;
        }

        const result = await this.executeTask(task);
        this.state.tasksCompleted.push(result);
        this.state.actionsToday++;
        this.state.costToday += result.costUsd;
      }

      // â”€â”€ Phase 3: REVIEW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      await this.reviewPhase();

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`Zyklus-Fehler: ${errMsg}`);
      this.emit({ type: "error", cycle: this.state.cycleCount, error: errMsg });
    } finally {
      this.emit({
        type: "cycle_end",
        cycle: this.state.cycleCount,
        actionsToday: this.state.actionsToday,
        costToday: this.state.costToday,
        tasksCompleted: this.state.tasksCompleted.length,
      });
      this.cycleRunning = false;
      // Persist session and cost data after each cycle
      this.session.save();
      this.costTracker.saveSession();
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PHASE 1: PLAN
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  private async planPhase(): Promise<AgentPlan | null> {
    this.log.plan("ðŸ“‹ Planungsphase gestartet...");

    const goalsContent = this.loadGoals();
    const systemPrompt = this.buildSystemPrompt();
    const userMessage = this.buildPlanningPrompt(goalsContent);

    this.log.think("ðŸ§  Agent analysiert Ziele und Kontext...");
    this.emit({ type: "planning", cycle: this.state.cycleCount });

    try {
      const response = await this.llm.send(
        [{ role: "user", content: userMessage }],
        systemPrompt,
      );
      this.state.costToday += response.costUsd;
      this.costTracker.addLlmCost(
        this.llm.getModel(),
        response.tokensUsed.prompt,
        response.tokensUsed.completion,
        response.costUsd,
      );

      const plan = this.parsePlan(response.text);

      // Log the agent's thinking
      if (plan.thinking) {
        // Split long thinking into lines for readability
        const thinkLines = plan.thinking.split(/[.!?]\s+/).filter(Boolean);
        for (const line of thinkLines.slice(0, 5)) {
          this.log.think(`ðŸ§  "${line.trim()}"`);
        }
      }

      // Log planned tasks
      this.log.plan(`ðŸ“‹ ${plan.tasks.length} Aufgaben geplant:`);
      for (const task of plan.tasks) {
        this.log.plan(`   ${task.id}. [${task.priority.toUpperCase()}] ${task.title}`);
      }

      this.emit({ type: "plan_complete", tasks: plan.tasks.length, thinking: plan.thinking?.substring(0, 200) });
      this.state.lastPlanTime = new Date();
      return plan;

    } catch (err) {
      this.log.error(`Planungsfehler: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PHASE 2: EXECUTE (Multi-turn Query Loop)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  private async executeTask(task: AgentTask): Promise<TaskResult> {
    this.state.currentTask = task;
    this.log.exec(`\nâ–¶ï¸ Aufgabe ${task.id}: ${task.title}`);
    this.log.exec(`   Typ: ${task.type} | PrioritÃ¤t: ${task.priority}`);
    this.emit({ type: "task_start", taskId: task.id, title: task.title, taskType: task.type });

    const start = Date.now();

    // â”€â”€â”€ Skill-based execution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // If the task type starts with "skill:", execute the matching MonetizationSkill
    if (task.type.startsWith("skill:") && this.skills) {
      const skillId = task.type.replace("skill:", "");
      this.log.exec(`   ðŸŽ¯ Skill-AusfÃ¼hrung: ${skillId}`);

      // Parse params from the task details (format: key=value, ...)
      const params: Record<string, string> = {};
      const paramMatch = task.details.match(/\{([^}]+)\}/g);
      if (paramMatch) {
        for (const match of paramMatch) {
          const inner = match.slice(1, -1);
          const [key, ...rest] = inner.split("=");
          if (key && rest.length > 0) {
            params[key.trim()] = rest.join("=").trim();
          }
        }
      }
      // Also treat the entire details as "topic" if no params found
      if (Object.keys(params).length === 0) {
        params.topic = task.details || task.title;
      }

      const skillResult = await this.skills.execute(skillId, params);
      const durationMs = Date.now() - start;

      return {
        taskId: task.id,
        title: task.title,
        success: skillResult.success,
        thinking: `Skill ${skillId} mit ${skillResult.stepsCompleted}/${skillResult.stepsTotal} Steps ausgefÃ¼hrt`,
        result: JSON.stringify(skillResult.outputs, null, 2),
        summary: skillResult.success
          ? `Skill ${skillId}: ${skillResult.stepsCompleted} Steps erfolgreich`
          : `Skill ${skillId}: ${skillResult.error}`,
        tokensUsed: { prompt: 0, completion: 0 },
        costUsd: skillResult.costUsd,
        durationMs,
      };
    }

    // Check learnings for relevant context
    const relevantLearnings = this.learning.recallLearnings(task.type + " " + task.title);
    const relevantErrors = this.learning.recallErrors(task.type + " " + task.title);

    try {
      const systemPrompt = this.buildExecutionSystemPrompt();
      let userMessage = this.buildExecutionPrompt(task);

      // Inject relevant learnings if any
      if (relevantLearnings.length > 0) {
        userMessage += "\n\n== RELEVANTE ERKENNTNISSE ==\n" + relevantLearnings.join("\n");
      }
      if (relevantErrors.length > 0) {
        userMessage += "\n\n== BEKANNTE FEHLER (VERMEIDE DIESE) ==\n" + relevantErrors.join("\n");
      }

      // Build tool context for this execution
      const toolCtx: ToolContext = {
        workspaceDir: this.configDir,
        permissionMode: "autonomous" as PermissionMode,
        getState: () => ({
          running: this.state.running,
          paused: this.state.paused,
          actionsToday: this.state.actionsToday,
          costToday: this.state.costToday,
          dailyBudgetUsd: this.config.financeLimits?.dailyApiBudgetUsd ?? 5,
          cycleCount: this.state.cycleCount,
          operatorEmailApproval: this.operatorEmailApproval,
        }),
      };

      // Progress callback for logging
      const onProgress: QueryProgressCallback = (event) => {
        switch (event.type) {
          case "tool_start":
            this.log.exec(`   ðŸ”§ Tool ${event.tool}...`);
            break;
          case "tool_result":
            if (event.success) {
              this.log.exec(`   âœ… Tool ${event.tool}: OK`);
            } else {
              this.log.error(`   âŒ Tool ${event.tool}: ${event.preview}`);
            }
            break;
          case "turn_complete":
            this.log.exec(`   â”€â”€ Turn ${event.turn} ($${event.totalCost.toFixed(4)})`);
            break;
          case "error":
            if (event.recoverable) {
              this.log.gateway(`   âš ï¸ ${event.message}`);
            } else {
              this.log.error(`   ðŸ’€ ${event.message}`);
            }
            break;
        }
      };

      // â”€â”€â”€ Execute via QueryLoop (multi-turn LLM â†” Tool) â”€â”€â”€â”€
      const queryResult: QueryResult = await this.queryLoop.query(
        systemPrompt,
        userMessage,
        toolCtx,
        {
          maxTurns: 8,
          maxQueryBudgetUsd: 0.5,
          maxRetries: 2,
        },
        onProgress,
      );

      const durationMs = Date.now() - start;

      // Extract thinking and summary from response
      let thinking = "";
      let result = queryResult.response;
      let summary = task.title;

      try {
        const parsed = this.extractJSON(queryResult.response);
        if (parsed) {
          thinking = parsed.thinking ?? "";
          result = parsed.result ?? queryResult.response;
          summary = parsed.summary ?? task.title;
        }
      } catch {
        // Raw text response is fine
      }

      if (thinking) {
        this.log.think(`ðŸ§  "${thinking.substring(0, 150)}"`);
      }

      // Log tool execution errors to learning system
      for (const tc of queryResult.toolCalls) {
        if (!tc.success) {
          this.learning.logError(
            `Task ${task.id} - ${tc.tool}`,
            tc.error ?? "Unbekannter Fehler",
          );
          continue;
        }

        if (tc.tool === "gog.gmail.send") {
          this.operatorEmailApproval = false;
          this.log.gateway("E-Mail gesendet: Operator-Freigabe wurde zur Sicherheit zurückgesetzt");
        }
      }

      // Save result to disk
      const filePath = await this.saveTaskResult(task, result, summary);
      this.log.exec(`âœ… Aufgabe ${task.id} abgeschlossen (${durationMs}ms, ${queryResult.turns} Turns, ${queryResult.toolCalls.length} Tool-Calls)`);
      this.log.exec(`   ðŸ’¾ Gespeichert: ${filePath}`);

      if (queryResult.truncated) {
        this.log.gateway(`   âš ï¸ Abgebrochen: ${queryResult.truncationReason}`);
      }

      this.state.currentTask = null;
      this.emit({ type: "task_complete", taskId: task.id, success: true, costUsd: queryResult.costUsd, durationMs });

      return {
        taskId: task.id,
        title: task.title,
        success: true,
        thinking,
        result,
        summary,
        tokensUsed: queryResult.tokensUsed,
        costUsd: queryResult.costUsd,
        durationMs,
      };

    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`âŒ Aufgabe ${task.id} fehlgeschlagen: ${errorMsg}`);

      // Log error to learning system
      this.learning.logError(
        `Task ${task.id}: ${task.title}`,
        errorMsg,
      );

      this.state.currentTask = null;
      this.emit({ type: "task_complete", taskId: task.id, success: false, error: errorMsg, durationMs });

      return {
        taskId: task.id,
        title: task.title,
        success: false,
        thinking: "",
        result: "",
        summary: `Fehler: ${errorMsg}`,
        tokensUsed: { prompt: 0, completion: 0 },
        costUsd: 0,
        durationMs,
      };
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PHASE 3: REVIEW
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  private async reviewPhase(): Promise<void> {
    const cycleTasks = this.state.tasksCompleted.slice(-10);
    const succeeded = cycleTasks.filter(t => t.success).length;
    const failed = cycleTasks.filter(t => !t.success).length;
    const cycleCost = cycleTasks.reduce((sum, t) => sum + t.costUsd, 0);

    this.log.gateway(`\nâ”€â”€ Zyklus #${this.state.cycleCount} Zusammenfassung â”€â”€`);
    this.log.ok(`âœ… Erfolg: ${succeeded} | âŒ Fehler: ${failed} | ðŸ’° Kosten: $${cycleCost.toFixed(4)}`);
    this.log.ok(`ðŸ“Š Gesamt heute: ${this.state.actionsToday} Aktionen, $${this.costTracker.getTodayCost().toFixed(4)}`);

    // Cost breakdown from tracker
    const tokens = this.costTracker.getSessionTokens();
    this.log.ok(`ðŸ“ˆ Session-Tokens: ${tokens.input} in / ${tokens.output} out | Calls: ${this.costTracker.getSessionCalls()} | Tools: ${this.costTracker.getToolExecutions()}`);

    // Record cycle in session
    this.session.recordCycle(cycleCost);

    // Log cycle learning
    if (succeeded > 0) {
      this.learning.logLearning(
        "Zyklus",
        `Zyklus #${this.state.cycleCount}: ${succeeded}/${succeeded + failed} Tasks erfolgreich, $${cycleCost.toFixed(4)} Kosten`,
      );
    }

    // Mark bootstrap as completed after first successful cycle
    if (this.bootstrap.isFirstStart() && succeeded > 0) {
      this.bootstrap.markCompleted();
      this.log.ok("ðŸŽ‰ Erster Zyklus erfolgreich â€“ Bootstrap abgeschlossen!");
    }

    // Notify operator via Telegram
    if (this.telegram && cycleTasks.length > 0) {
      const lines = [
        `ðŸ¦€ *Zyklus #${this.state.cycleCount} abgeschlossen*`,
        `âœ… ${succeeded} erfolgreich | âŒ ${failed} fehlgeschlagen`,
        `ðŸ’° Kosten: $${cycleCost.toFixed(4)}`,
        "",
        "*Tasks:*",
      ];
      for (const t of cycleTasks) {
        lines.push(`${t.success ? "âœ…" : "âŒ"} ${t.title}`);
      }

      // Add learning stats
      const lStats = this.learning.getStats();
      if (lStats.learnings > 0 || lStats.errors > 0) {
        lines.push("");
        lines.push(`ðŸ“š Learnings: ${lStats.learnings} | Errors: ${lStats.errors}`);
      }

      await this.telegram.sendToOperator(lines.join("\n"));
    }

    // Save daily log
    this.saveDailyLog();

    this.emit({ type: "review_complete", cycle: this.state.cycleCount, succeeded, failed, costUsd: cycleCost });
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PROMPT BUILDING
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  private buildSystemPrompt(): string {
    // Use bootstrap manager for identity context
    const bootstrapPrompt = this.bootstrap.buildSystemPrompt();

    const agentName = this.config.agent?.name ?? "Cash-Claw";
    const owner = this.config.agent?.owner ?? "Operator";
    const currency = this.config.agent?.currency ?? "EUR";

    const lines = [
      `Du bist ${agentName}, ein autonomer KI-Agent der Geld verdient.`,
      `Dein Besitzer: ${owner}`,
      `WÃ¤hrung: ${currency}`,
      `Datum: ${new Date().toLocaleDateString("de-DE")}`,
      `Uhrzeit: ${new Date().toLocaleTimeString("de-DE")}`,
      "",
    ];

    // Available services
    if (this.config.services) {
      lines.push("== AKTIVE SERVICES ==");
      for (const [key, svc] of Object.entries(this.config.services)) {
        if (!svc.enabled) continue;
        const prices = Object.entries(svc.pricing)
          .map(([tier, price]) => `${tier}: ${currency === "EUR" ? "â‚¬" : "$"}${price}`)
          .join(" | ");
        lines.push(`- ${key}: ${svc.description} [${prices}]`);
      }
      lines.push("");
    }

    // Active categories
    lines.push("== KATEGORIEN ==");
    const cats = this.config.categories ?? {};
    if (cats.content)  lines.push("- Content: BÃ¼cher, YouTube, Blogs, Social Media");
    if (cats.outreach) lines.push("- Outreach: Cold-Email, Lead-Gen, Freelance");
    if (cats.finance)  lines.push("- Finance: Trading, Krypto, Prediction Markets");
    if (cats.products) lines.push("- Products: Digitale Produkte, PoD, SaaS");
    lines.push("");

    // Constraints
    lines.push("== EINSCHRÃ„NKUNGEN ==");
    lines.push(`- Aktiv von ${this.config.schedule?.activeFrom ?? "00:00"} bis ${this.config.schedule?.activeTo ?? "24:00"}`);
    lines.push(`- Max ${this.config.schedule?.maxActionsPerDay ?? 50} Aktionen/Tag`);
    lines.push(`- API-Budget: $${this.config.financeLimits?.dailyApiBudgetUsd ?? 5}/Tag`);
    lines.push(`- Auszahlung ab ${this.config.stripe?.minPayout ?? 50} ${currency}`);
    if (this.config.categories?.finance) {
      lines.push(`- Max Tagesrisiko Trading: ${this.config.financeLimits?.maxDailyRiskPercent ?? 2}%`);
      lines.push(`- Min Bet-Edge: ${this.config.financeLimits?.minBetEdgePercent ?? 5}%`);
    }
    lines.push("");

    // Tool registry auto-generated prompt (grouped by category with Zod schemas)
    lines.push("== TOOLS ==");
    lines.push(this.registry.generateSystemPrompt());
    lines.push("");

    // Inject relevant learnings
    const learningStats = this.learning.getStats();
    if (learningStats.learnings > 0) {
      lines.push("== BISHERIGE ERKENNTNISSE ==");
      lines.push(this.learning.getAllLearnings());
      lines.push("");
    }

    // Inject monetization skills
    if (this.skills) {
      lines.push(this.skills.getSkillsDescription());
      lines.push("");
      lines.push("Du kannst Skills als Task-Typ nutzen, z.B. type: 'skill:blog-post' mit params im Details-Feld.");
    }

    if (this.openclaw) {
      lines.push("");
      lines.push("== OPENCLAW / CLAWHUB ==");
      lines.push(`- OpenClaw Workspace: ${this.openclaw.getWorkspaceRoot() ?? "nicht erkannt"}`);
      lines.push("- Nutze openclaw.skills.list/install/read für Skill-Verwaltung.");
      lines.push("- Wenn Faehigkeiten fehlen: zuerst passenden Skill installieren, dann weitermachen.");
    }

    lines.push("Antworte immer sachlich und effizient. Priorisiere ROI.");
    lines.push("Du kannst Tools nutzen indem du JSON-BlÃ¶cke in deine Antwort einfÃ¼gst.");
    lines.push("PrÃ¼fe vor jeder Aufgabe, ob du sie mit vorhandenen Tools/Skills sauber umsetzen kannst.");
    lines.push("Wenn nicht: Skill suchen/installieren oder neuen Skill erstellen, statt blind weiterzumachen.");

    // Combine: bootstrap context first, then runtime context
    return bootstrapPrompt + "\n\n" + lines.join("\n");
  }

  private buildPlanningPrompt(goalsContent: string): string {
    const maxActions = this.config.schedule?.maxActionsPerDay ?? 50;
    const apiBudget = this.config.financeLimits?.dailyApiBudgetUsd ?? 5;

    const lines = [
      "== ZIELE ==",
      goalsContent || "(Keine GOALS.md gefunden â€“ erstelle einen allgemeinen Plan)",
      "",
      "== HEUTIGER STATUS ==",
      `- Aktionen bisher: ${this.state.actionsToday}/${maxActions}`,
      `- API-Kosten bisher: $${this.state.costToday.toFixed(4)}/$${apiBudget}`,
      `- Erledigte Tasks heute: ${this.state.tasksCompleted.length}`,
      `- Bisherige Zyklen: ${this.state.cycleCount}`,
      "",
    ];

    // Add learning stats if available
    const lStats = this.learning.getStats();
    if (lStats.learnings > 0 || lStats.errors > 0) {
      lines.push("== LERNSYSTEM ==");
      lines.push(`- Erkenntnisse: ${lStats.learnings}`);
      lines.push(`- Bekannte Fehler: ${lStats.errors}`);
      lines.push(`- Feature Requests: ${lStats.features}`);
      lines.push("");
    }

    lines.push(
      "== AUFGABE ==",
      "Erstelle einen konkreten Plan fÃ¼r die nÃ¤chsten Aktionen.",
      "Plane maximal 3 Tasks pro Zyklus. Fokus auf hohen ROI.",
      "Nutze verfÃ¼gbare Tools (E-Mail, Browser, Suche, etc.) wenn es Sinn macht.",
      "Outreach-Regel: Erste E-Mail immer erst als Entwurf dem Operator zeigen, Feedback einarbeiten, dann erst senden.",
      "Outreach-Regel: FÃ¼r jede Firma eine eigene Datei unter leads/companies/<slug>.md anlegen (Analyse, Status, nÃ¤chster Schritt).",
      "Bevor du etwas planst: prÃ¼fe zuerst, ob du die Umsetzung wirklich kannst. Wenn nicht, plane Skill-Suche/Skill-Installation oder Skill-Erstellung.",
      "Nutze bei fehlenden Faehigkeiten bevorzugt openclaw.skills.list/install/read.",
      "",
      "Du kannst Skills als Task-Typ nutzen. VerfÃ¼gbare Skill-Typen:",
    );

    // List available skill IDs so the LLM includes them naturally
    if (this.skills) {
      for (const skill of this.skills.getSkills()) {
        lines.push(`  - skill:${skill.id} â€“ ${skill.name} (~${skill.estimatedMinutes}min, ${skill.estimatedRevenue})`);
      }
    }
    lines.push("");

    lines.push(
      "Antworte NUR im folgenden JSON-Format (keine Zusatztexte):",
      "```json",
      "{",
      '  "thinking": "Deine Ãœberlegung, was als nÃ¤chstes zu tun ist und warum",',
      '  "tasks": [',
      "    {",
      '      "id": 1,',
      '      "type": "skill:blog-post|skill:newsletter|skill:seo-audit|content_writing|lead_generation|email_outreach|social_media|web_research|...",',
      '      "title": "Kurze Beschreibung der Aufgabe",',
      '      "details": "AusfÃ¼hrliche Beschreibung was genau zu tun ist, welche Tools zu nutzen sind. Bei Skills: Parameter als {key=value}",',
      '      "estimatedMinutes": 5,',
      '      "priority": "high|medium|low"',
      "    }",
      "  ]",
      "}",
      "```",
    );

    return lines.join("\n");
  }

  private buildExecutionSystemPrompt(): string {
    const agentName = this.config.agent?.name ?? "Cash-Claw";
    const compactIdentity = this.bootstrap.buildCompactPrompt();

    return [
      compactIdentity,
      "",
      `Du bist ${agentName} und arbeitest gerade an einer konkreten Aufgabe.`,
      "Liefere ein hochwertiges, sofort verwendbares Ergebnis.",
      "Schreibe professionell, detailliert und zielgerichtet.",
      "Wenn du Outreach machst: pro Firma eine Datei unter leads/companies/<slug>.md pflegen.",
      "Wenn du E-Mails versenden willst: zuerst Entwurf an Operator senden und auf Freigabe warten.",
      "Wenn du etwas nicht sicher umsetzen kannst: fehlende FÃ¤higkeit benennen, Skill suchen/installieren oder neuen Skill entwerfen.",
      "Nutze openclaw.skills.* Tools fuer Skill-Suche, Installation und Skill-Durchgaenge.",
      "",
      "== TOOLS ==",
      this.registry.generateSystemPrompt(),
      "",
      "== TOOL-AUFRUF-FORMAT ==",
      "Rufe Tools auf, indem du JEDEN Tool-Aufruf als eigenen JSON-Block schreibst:",
      "```json",
      '{ "action": "tool", "id": "call-1", "tool": "<tool-name>", "params": { ... } }',
      "```",
      "",
      "Du kannst mehrere Tool-Aufrufe in einer Antwort machen (jeweils als separater Block).",
      "Warte auf die Tool-Ergebnisse, bevor du den naechsten Schritt planst.",
      "Nutze KEIN 'actions'-Array - schreibe jeden Tool-Aufruf als einzelnen Block.",
      "",
      "== ABSCHLUSS-FORMAT (wenn alle Tools fertig oder kein Tool noetig) ==",
      "```json",
      "{",
      '  "thinking": "Dein Denkprozess bei dieser Aufgabe",',
      '  "result": "Das vollstaendige Ergebnis (Text, Code, Analyse etc.)",',
      '  "summary": "Einzeilige Zusammenfassung fuer den Operator"',
      "}",
      "```",
    ].join("\n");
  }

  private buildExecutionPrompt(task: AgentTask): string {
    return [
      `== AUFGABE ==`,
      `Typ: ${task.type}`,
      `Titel: ${task.title}`,
      `Details: ${task.details}`,
      `PrioritÃ¤t: ${task.priority}`,
      "",
      "Erstelle jetzt das Ergebnis. Sei grÃ¼ndlich und professionell.",
    ].join("\n");
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  private async sendOnboardingPromptIfNeeded(): Promise<void> {
    if (!this.onboardingGate.enabled || this.onboardingGate.startupPromptSent) {
      return;
    }

    this.onboardingGate.startupPromptSent = true;
    this.log.gateway("Onboarding-Modus aktiv: Agent wartet auf User-Briefing vor autonomen Tasks");

    if (!this.telegram) {
      return;
    }

    const lines = [
      "Ich bin jetzt als Chatbot-Mitarbeiter aktiv.",
      "Bevor ich autonom starte, brauche ich dein Briefing.",
      "",
      "Bitte schicke mir nacheinander:",
      "- Hauptziele und Prioritaeten",
      "- Do/Don'ts und Grenzen",
      "- Zielgruppe, Kanal, Deadline",
      "- Welche Tools/Konten ich nutzen darf (z.B. Gmail, Browser, Sheets)",
      "- Ob ich E-Mails erst zur Freigabe vorlegen soll (empfohlen: ja)",
      "- Welche Standard-Skills ich aktiv nutzen/installieren soll (OpenClaw/ClawHub)",
      "",
      "Sobald genug Kontext da ist, starte ich selbststaendig und gebe dir ein Update.",
      "Tipp: Du kannst schreiben 'installiere skill <name>'.",
    ];

    await this.telegram.sendToOperator(lines.join("\n"));
  }

  private trackOnboardingInput(text: string): void {
    this.onboardingGate.totalUserMessages += 1;
    this.onboardingGate.totalUserChars += text.length;
  }

  private isOnboardingThresholdReached(): boolean {
    return this.onboardingGate.totalUserMessages >= this.onboardingGate.minMessages
      && this.onboardingGate.totalUserChars >= this.onboardingGate.minTotalChars;
  }

  private buildOperatorChatMessages(latestUserInput: string): Array<{ role: "user" | "assistant"; content: string }> {
    const history = this.session.getRecentMessages(12)
      .filter(msg => msg.role === "user" || msg.role === "assistant")
      .map(msg => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      }));

    history.push({ role: "user", content: latestUserInput });
    return history;
  }

  private buildOperatorChatSystemPrompt(): string {
    const agentName = this.config.agent?.name ?? "Cash-Claw";
    const owner = this.config.agent?.owner ?? "Operator";
    const compactIdentity = this.bootstrap.buildCompactPrompt();

    return [
      compactIdentity,
      "",
      `Du bist ${agentName}, der KI-Mitarbeiter von ${owner}.`,
      "Du bleibst immer ein hilfreicher Chatbot und beantwortest direkte Fragen klar und konkret.",
      "Wenn noch nicht genug Kontext vorhanden ist, stelle gezielte Rueckfragen statt autonom zu handeln.",
      "Wenn Tool-Zugang fehlt (z.B. Gmail), frage konkret danach.",
      "Bei Outreach gilt: erst Entwurf zeigen, Feedback einarbeiten, dann senden.",
      "Wenn der Operator etwas korrigiert, extrahiere daraus eine allgemeine Lernregel.",
      "Wenn Umsetzung ohne neue Faehigkeit nicht geht, markiere needsSkill.",
      "Wenn der Operator Skill-Installation fordert, nutze needsSkill mit dem konkreten Skillnamen.",
      "",
      "Onboarding-Status:",
      `- Chat-Nachrichten: ${this.onboardingGate.totalUserMessages}/${this.onboardingGate.minMessages}`,
      `- Zeichen gesamt: ${this.onboardingGate.totalUserChars}/${this.onboardingGate.minTotalChars}`,
      `- Bereits freigeschaltet: ${this.onboardingGate.unlocked ? "ja" : "nein"}`,
      `- Fehlende Tools aktuell: ${this.onboardingGate.missingTools.join(", ") || "keine"}`,
      `- OpenClaw Skills verfügbar: ${this.openclaw ? "ja" : "nein"}`,
      "",
      "Regeln fuer deine Antwort:",
      "- Antworte kurz, professionell und wie ein echter Mitarbeiter.",
      "- Wenn Kontext fehlt: Rueckfragen priorisieren.",
      "- Wenn Kontext und Tools reichen: readyToStart=true setzen.",
      "- Wenn Tools fehlen: missingTools fuellen und readyToStart=false.",
      "- Wenn User explizit 'freigeben/senden' fuer E-Mail sagt: emailApproved=true.",
      "- Wenn der User eine Korrektur formuliert: correctionLearning als allgemeine Regel schreiben.",
      "- Antworte NUR im JSON-Format.",
      "",
      "JSON-Format:",
      "```json",
      "{",
      '  "reply": "Natuerliche Chat-Antwort an den Operator",',
      '  "readyToStart": false,',
      '  "rationale": "Kurze Begruendung der Entscheidung",',
      '  "missingTools": ["gog.gmail.send"],',
      '  "correctionLearning": "Personalisierte Erstsaetze immer auf reale Beobachtung stützen.",',
      '  "emailApproved": false,',
      '  "needsSkill": ""',
      "}",
      "```",
    ].join("\n");
  }

  private parseOperatorChatDecision(text: string): OperatorChatDecision {
    const fallbackReply = text.trim() || "Verstanden. Gib mir bitte mehr Kontext, damit ich sauber starten kann.";
    const parsed = this.extractJSON(text);

    if (!parsed || typeof parsed !== "object") {
      return {
        reply: fallbackReply,
        readyToStart: false,
        rationale: "",
        missingTools: [],
        correctionLearning: "",
        emailApproved: false,
        needsSkill: "",
      };
    }

    const reply = typeof parsed.reply === "string" && parsed.reply.trim().length > 0
      ? parsed.reply.trim()
      : fallbackReply;

    const readyToStart = parsed.readyToStart === true;
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
    const missingTools = Array.isArray(parsed.missingTools)
      ? parsed.missingTools.filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0).map((v: string) => v.trim())
      : [];
    const correctionLearning = typeof parsed.correctionLearning === "string"
      ? parsed.correctionLearning.trim()
      : "";
    const emailApproved = parsed.emailApproved === true;
    const needsSkill = typeof parsed.needsSkill === "string"
      ? parsed.needsSkill.trim()
      : "";

    return { reply, readyToStart, rationale, missingTools, correctionLearning, emailApproved, needsSkill };
  }

  private async unlockAutonomousWork(reason: string): Promise<void> {
    if (this.onboardingGate.unlocked) {
      return;
    }

    this.onboardingGate.unlocked = true;
    this.onboardingGate.missingTools = [];
    this.onboardingGate.lastDecisionAt = new Date();

    this.log.gateway(`Onboarding abgeschlossen: autonomer Modus freigeschaltet (${reason})`);
    this.emit({
      type: "onboarding_unlocked",
      reason,
      messages: this.onboardingGate.totalUserMessages,
      chars: this.onboardingGate.totalUserChars,
    });

    if (this.telegram) {
      await this.telegram.sendToOperator([
        "Update: Genug Kontext gesammelt.",
        "Ich starte jetzt den ersten autonomen Zyklus.",
        `Entscheidungsgrund: ${reason}`,
      ].join("\n"));
    }

    setTimeout(() => {
      void this.runCycle();
    }, 800);
  }

  private async runHourlyWakeup(): Promise<void> {
    if (!this.state.running || this.state.paused || this.cycleRunning) {
      return;
    }
    if (this.onboardingGate.enabled && !this.onboardingGate.unlocked) {
      return;
    }

    const recentTasks = this.state.tasksCompleted.slice(-8);
    const taskSummary = recentTasks.length === 0
      ? "Noch keine abgeschlossenen Tasks."
      : recentTasks
          .map(t => `${t.success ? "OK" : "FAIL"} | ${t.title} | $${t.costUsd.toFixed(4)}`)
          .join("\n");

    const prompt = [
      HOURLY_GATEWAY_WAKE_PROMPT,
      "",
      "Du bist im stündlichen Proaktiv-Check.",
      "Entscheide, was jetzt sinnvoll ist:",
      "- Wenn Outreach läuft und keine Antworten sichtbar sind: mehr qualifizierte Firmen recherchieren und neue Ansprache vorbereiten.",
      "- Frage den Operator regelmäßig nach weiteren monetarisierbaren Ideen.",
      "- Wenn du bereits gute Pipeline hast, triggerCycle=true setzen.",
      "",
      "Aktueller Status:",
      `- Zyklen heute: ${this.state.cycleCount}`,
      `- Aktionen heute: ${this.state.actionsToday}`,
      `- Kosten heute: $${this.state.costToday.toFixed(4)}`,
      `- E-Mail-Freigabe aktiv: ${this.operatorEmailApproval ? "ja" : "nein"}`,
      "",
      "Letzte Tasks:",
      taskSummary,
      "",
      "Antworte nur als JSON:",
      "```json",
      "{",
      '  "operatorUpdate": "Kurzes Proaktiv-Update für den Operator",',
      '  "triggerCycle": true,',
      '  "askNewIdeas": "Konkrete Frage nach weiteren Geld-Ideen oder leer"',
      "}",
      "```",
    ].join("\n");

    try {
      const response = await this.llm.send(
        [{ role: "user", content: prompt }],
        this.buildExecutionSystemPrompt(),
      );
      this.state.costToday += response.costUsd;
      this.costTracker.addLlmCost(
        this.llm.getModel(),
        response.tokensUsed.prompt,
        response.tokensUsed.completion,
        response.costUsd,
      );

      const decision = this.parseHourlyWakeDecision(response.text);
      if (this.telegram && (decision.operatorUpdate || decision.askNewIdeas)) {
        const lines = ["Proaktiv-Update (stündlich):"];
        if (decision.operatorUpdate) lines.push(decision.operatorUpdate);
        if (decision.askNewIdeas) {
          lines.push("");
          lines.push(decision.askNewIdeas);
        }
        await this.telegram.sendToOperator(lines.join("\n"));
      }

      if (decision.triggerCycle) {
        this.log.gateway("Stündlicher Wakeup triggert einen zusätzlichen Arbeitszyklus");
        void this.runCycle();
      }
    } catch (err) {
      this.log.error(`Stündlicher Wakeup fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private parseHourlyWakeDecision(text: string): HourlyWakeDecision {
    const parsed = this.extractJSON(text);
    if (!parsed || typeof parsed !== "object") {
      return { operatorUpdate: "", triggerCycle: false, askNewIdeas: "" };
    }

    const operatorUpdate = typeof parsed.operatorUpdate === "string" ? parsed.operatorUpdate.trim() : "";
    const triggerCycle = parsed.triggerCycle === true;
    const askNewIdeas = typeof parsed.askNewIdeas === "string" ? parsed.askNewIdeas.trim() : "";
    return { operatorUpdate, triggerCycle, askNewIdeas };
  }
//  HELPERS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  private loadGoals(): string {
    const goalsPath = path.join(this.configDir, "GOALS.md");
    try {
      if (fs.existsSync(goalsPath)) {
        const content = fs.readFileSync(goalsPath, "utf-8");
        this.log.plan(`ðŸ“„ GOALS.md geladen (${content.length} Zeichen)`);
        return content;
      }
    } catch {
      // ignore
    }
    this.log.plan("âš ï¸ Keine GOALS.md gefunden");
    return "";
  }

  private parsePlan(text: string): AgentPlan {
    const json = this.extractJSON(text);
    if (!json) {
      throw new Error("Kein gÃ¼ltiges JSON in der LLM-Antwort gefunden");
    }

    return {
      thinking: json.thinking ?? "",
      tasks: Array.isArray(json.tasks)
        ? json.tasks.map((t: AgentTask, i: number) => ({
            id: t.id ?? i + 1,
            type: t.type ?? "general",
            title: t.title ?? `Task ${i + 1}`,
            details: t.details ?? "",
            estimatedMinutes: t.estimatedMinutes ?? 5,
            priority: t.priority ?? "medium",
          }))
        : [],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractJSON(text: string): any | null {
    // Try to find JSON in the response (possibly wrapped in ```json ... ```)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();

    try {
      return JSON.parse(jsonStr);
    } catch {
      // Try to extract JSON object from the text
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private async saveTaskResult(task: AgentTask, result: string, summary: string): Promise<string> {
    const today = new Date().toISOString().split("T")[0];
    const dir = path.join(this.configDir, "tasks", today);
    fs.mkdirSync(dir, { recursive: true });

    const slug = task.title
      .toLowerCase()
      .replace(/[^a-z0-9Ã¤Ã¶Ã¼]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 40);
    const filename = `task-${String(task.id).padStart(3, "0")}-${slug}.md`;
    const filePath = path.join(dir, filename);

    const content = [
      `# ${task.title}`,
      "",
      `**Typ:** ${task.type}`,
      `**PrioritÃ¤t:** ${task.priority}`,
      `**Zusammenfassung:** ${summary}`,
      `**Erstellt:** ${new Date().toISOString()}`,
      "",
      "---",
      "",
      result,
    ].join("\n");

    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  private saveDailyLog(): void {
    const today = new Date().toISOString().split("T")[0];
    const dir = path.join(this.configDir, "tasks", today);
    fs.mkdirSync(dir, { recursive: true });

    const logPath = path.join(dir, "daily-log.json");
    const log = {
      date: today,
      cycles: this.state.cycleCount,
      actionsToday: this.state.actionsToday,
      costToday: this.state.costToday,
      tasks: this.state.tasksCompleted.map(t => ({
        id: t.taskId,
        title: t.title,
        success: t.success,
        costUsd: t.costUsd,
        durationMs: t.durationMs,
        summary: t.summary,
      })),
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
  }

  private isInActiveHours(): boolean {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const from = this.parseTime(this.config.schedule?.activeFrom ?? "00:00");
    const to = this.parseTime(this.config.schedule?.activeTo ?? "24:00");

    if (to === 1440) return currentMinutes >= from; // "24:00" = always active after from
    return currentMinutes >= from && currentMinutes < to;
  }

  private parseTime(time: string): number {
    const [h, m] = time.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }

  private notifyStartupInLogs(summary: StartupMarkdownScanSummary): void {
    this.log.gateway(`Startup-Scan: ${summary.filesRead} Markdown-Dateien gelesen (${(summary.totalBytes / 1024).toFixed(1)}KB)`);
    if (summary.readErrors > 0) {
      this.log.gateway(`Startup-Scan: ${summary.readErrors} Datei(en) konnten nicht gelesen werden`);
    }
    if (summary.sampleFiles.length > 0) {
      this.log.gateway(`Startup-Scan Beispiele: ${summary.sampleFiles.join(", ")}`);
    }
  }

  private async notifyOperatorStartupScan(summary: StartupMarkdownScanSummary): Promise<void> {
    this.notifyStartupInLogs(summary);

    if (!this.telegram) {
      return;
    }

    const lines = [
      "Startup-Check abgeschlossen.",
      `Markdown-Dateien gelesen: ${summary.filesRead}`,
      `Gesamtgroesse: ${(summary.totalBytes / 1024).toFixed(1)} KB`,
      "",
      "Scan-Roots:",
      ...summary.roots.map(root => `- ${root}`),
    ];

    if (summary.sampleFiles.length > 0) {
      lines.push("");
      lines.push("Beispiele:");
      lines.push(...summary.sampleFiles.map(file => `- ${file}`));
    }

    if (summary.filesRead > summary.sampleFiles.length) {
      lines.push(`... und ${summary.filesRead - summary.sampleFiles.length} weitere`);
    }

    if (summary.readErrors > 0) {
      lines.push(`Warnung: ${summary.readErrors} Datei(en) konnten nicht gelesen werden.`);
    }

    await this.telegram.sendToOperator(lines.join("\n"));
  }

  private scanMarkdownFilesOnStartup(): StartupMarkdownScanSummary {
    const roots = this.getStartupMarkdownRoots();
    const seen = new Set<string>();
    const sampleFiles: string[] = [];
    let filesRead = 0;
    let totalBytes = 0;
    let readErrors = 0;

    for (const root of roots) {
      const stack: string[] = [root];

      while (stack.length > 0) {
        const dir = stack.pop();
        if (!dir) continue;

        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const normalizedPath = path.normalize(fullPath);
          if (seen.has(normalizedPath)) continue;
          seen.add(normalizedPath);

          if (entry.isDirectory()) {
            if (!this.shouldSkipStartupDir(entry.name)) {
              stack.push(fullPath);
            }
            continue;
          }

          if (!entry.isFile()) continue;
          if (!entry.name.toLowerCase().endsWith(".md")) continue;

          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            filesRead++;
            totalBytes += Buffer.byteLength(content, "utf-8");
            if (sampleFiles.length < 15) {
              sampleFiles.push(this.toDisplayPath(root, fullPath));
            }
          } catch {
            readErrors++;
          }
        }
      }
    }

    return { roots, filesRead, totalBytes, readErrors, sampleFiles };
  }

  private getStartupMarkdownRoots(): string[] {
    const roots = new Set<string>();
    const baseRoot = path.resolve(this.configDir);
    if (fs.existsSync(baseRoot)) {
      roots.add(baseRoot);
    }

    const openclawWorkspace = this.config.openclaw?.workspace?.trim();
    if (openclawWorkspace) {
      const workspaceRoot = path.resolve(openclawWorkspace);
      if (fs.existsSync(workspaceRoot)) {
        roots.add(workspaceRoot);
      }
    }

    return Array.from(roots).sort();
  }

  private shouldSkipStartupDir(name: string): boolean {
    const ignored = new Set([
      ".git",
      ".svn",
      ".hg",
      "node_modules",
      "dist",
      "build",
      "coverage",
      ".cache",
      ".next",
      ".turbo",
    ]);
    return ignored.has(name);
  }

  private toDisplayPath(root: string, fullPath: string): string {
    const relative = path.relative(root, fullPath);
    const normalizedRoot = path.normalize(root);
    const normalizedConfigDir = path.normalize(this.configDir);
    if (normalizedRoot === normalizedConfigDir) {
      return `.cashclaw/${relative.replaceAll("\\", "/")}`;
    }
    const label = path.basename(root);
    return `${label}/${relative.replaceAll("\\", "/")}`;
  }
}




