// DailyReflection – Nächtliche Selbstreflexion (Phase 4)
// Am Ende jedes Tages: Leistung bewerten, Learnings promoten, Ziele anpassen

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GatewayLogger } from "./GatewayLogger.js";
import type { LLMAdapter } from "./LLMAdapter.js";
import type { TelegramAdapter } from "./TelegramAdapter.js";
import type { LearningSystem } from "./LearningSystem.js";
import type { BootstrapManager } from "./BootstrapManager.js";
import type { CashClawConfig } from "../config/types.js";

export interface DailyStats {
  date: string;
  cyclesRun: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalCostUsd: number;
  totalEarned: number;
  newLearnings: number;
  newErrors: number;
  topTaskTypes: Record<string, number>;
}

export interface ReflectionResult {
  date: string;
  summary: string;
  achievements: string[];
  improvements: string[];
  tomorrowPlan: string[];
  promotedLearnings: string[];
  costUsd: number;
}

export class DailyReflection {
  private configDir: string;
  private reflectionHour = 23; // 23:00
  private reflectionMinute = 0;
  private lastReflectionDate: string | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: CashClawConfig,
    private llm: LLMAdapter,
    private telegram: TelegramAdapter | null,
    private learning: LearningSystem,
    private log: GatewayLogger,
    private bootstrap: BootstrapManager | null = null,
  ) {
    this.configDir = path.join(os.homedir(), ".cashclaw");
  }

  /** Start the daily reflection scheduler */
  start(): void {
    // Check every 5 minutes if it's reflection time
    this.intervalId = setInterval(() => this.checkReflectionTime(), 5 * 60 * 1000);

    // Load last reflection date
    this.loadState();
    this.log.gateway(`Tägliche Reflexion geplant: ${this.reflectionHour}:${String(this.reflectionMinute).padStart(2, "0")} Uhr`);
  }

  /** Stop the scheduler */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Force a reflection now (can be triggered by operator) */
  async runNow(): Promise<ReflectionResult> {
    return this.performReflection();
  }

  // ═══════════════════════════════════════════════════════════════
  //  MAIN REFLECTION
  // ═══════════════════════════════════════════════════════════════

  private checkReflectionTime(): void {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    // Already reflected today?
    if (this.lastReflectionDate === today) return;

    // Is it reflection time?
    if (now.getHours() === this.reflectionHour && now.getMinutes() >= this.reflectionMinute) {
      this.performReflection().catch(err => {
        this.log.error(`Reflexion fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  private async performReflection(): Promise<ReflectionResult> {
    const today = new Date().toISOString().split("T")[0];
    this.log.gateway(`\n🌙 Tägliche Reflexion gestartet (${today})`);

    try {
      // 1. Gather today's stats
      const stats = this.gatherDailyStats(today);

      // 2. Get all learnings and errors
      const allLearnings = this.learning.getAllLearnings();
      const allErrors = this.learning.getAllErrors();
      const learningStats = this.learning.getStats();

      // 3. Read current GOALS.md
      const goalsPath = path.join(this.configDir, "GOALS.md");
      const currentGoals = fs.existsSync(goalsPath)
        ? fs.readFileSync(goalsPath, "utf-8")
        : "";

      // 4. Ask LLM for reflection
      const systemPrompt = this.buildReflectionSystemPrompt();
      const userPrompt = this.buildReflectionUserPrompt(stats, allLearnings, allErrors, learningStats, currentGoals);

      const response = await this.llm.send(
        [{ role: "user", content: userPrompt }],
        systemPrompt,
      );

      // 5. Parse reflection
      const reflection = this.parseReflection(response.text, today, response.costUsd);

      // 6. Save reflection to disk
      this.saveReflection(reflection);

      // 7. Promote learnings if any
      if (reflection.promotedLearnings.length > 0) {
        this.promoteToSoul(reflection.promotedLearnings);
      }

      // 8. Update GOALS.md with tomorrow's plan
      if (reflection.tomorrowPlan.length > 0) {
        this.updateGoalsFocus(reflection.tomorrowPlan, today);
      }

      // 9. Send report to operator
      if (this.telegram) {
        await this.sendReflectionReport(reflection, stats);
      }

      // 10. Mark as done
      this.lastReflectionDate = today;
      this.saveState();

      this.log.ok(`🌙 Reflexion abgeschlossen – ${reflection.achievements.length} Erfolge, ${reflection.improvements.length} Verbesserungen`);
      return reflection;

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`Reflexion fehlgeschlagen: ${errorMsg}`);
      this.learning.logError("DailyReflection", errorMsg);

      return {
        date: today,
        summary: `Reflexion fehlgeschlagen: ${errorMsg}`,
        achievements: [],
        improvements: [],
        tomorrowPlan: [],
        promotedLearnings: [],
        costUsd: 0,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DATA GATHERING
  // ═══════════════════════════════════════════════════════════════

  private gatherDailyStats(date: string): DailyStats {
    const logPath = path.join(this.configDir, "tasks", date, "daily-log.json");

    const stats: DailyStats = {
      date,
      cyclesRun: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      totalCostUsd: 0,
      totalEarned: 0,
      newLearnings: 0,
      newErrors: 0,
      topTaskTypes: {},
    };

    if (fs.existsSync(logPath)) {
      try {
        const log = JSON.parse(fs.readFileSync(logPath, "utf-8"));
        stats.cyclesRun = log.cycles ?? 0;
        stats.totalCostUsd = log.costToday ?? 0;
        stats.tasksCompleted = (log.tasks ?? []).filter((t: { success: boolean }) => t.success).length;
        stats.tasksFailed = (log.tasks ?? []).filter((t: { success: boolean }) => !t.success).length;

        for (const task of log.tasks ?? []) {
          const type = task.type ?? "unknown";
          stats.topTaskTypes[type] = (stats.topTaskTypes[type] ?? 0) + 1;
        }
      } catch {
        // ignore parse errors
      }
    }

    // Count task result files
    const taskDir = path.join(this.configDir, "tasks", date);
    if (fs.existsSync(taskDir)) {
      const files = fs.readdirSync(taskDir).filter(f => f.startsWith("task-") && f.endsWith(".md"));
      if (stats.tasksCompleted === 0) {
        stats.tasksCompleted = files.length;
      }
    }

    const lStats = this.learning.getStats();
    stats.newLearnings = lStats.learnings;
    stats.newErrors = lStats.errors;

    return stats;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROMPT BUILDING
  // ═══════════════════════════════════════════════════════════════

  private buildReflectionSystemPrompt(): string {
    const agentName = this.config.agent?.name ?? "Cash-Claw";
    return [
      `Du bist ${agentName} und führst deine tägliche Selbstreflexion durch.`,
      "Analysiere deinen Tag ehrlich und konstruktiv.",
      "Erstelle konkrete Verbesserungsvorschläge für morgen.",
      "",
      "Antworte NUR im JSON-Format:",
      "```json",
      "{",
      '  "summary": "Zusammenfassung des Tages in 2-3 Sätzen",',
      '  "achievements": ["Erfolg 1", "Erfolg 2"],',
      '  "improvements": ["Verbesserung 1", "Verbesserung 2"],',
      '  "tomorrowPlan": ["Plan 1", "Plan 2", "Plan 3"],',
      '  "promotedLearnings": ["Learning das promoted werden soll (nur wenn 3+ Bestätigungen)"]',
      "}",
      "```",
    ].join("\n");
  }

  private buildReflectionUserPrompt(
    stats: DailyStats,
    learnings: string,
    errors: string,
    lStats: { learnings: number; errors: number; features: number },
    goals: string,
  ): string {
    return [
      `== TAGESSTATISTIK (${stats.date}) ==`,
      `Zyklen: ${stats.cyclesRun}`,
      `Tasks erledigt: ${stats.tasksCompleted}`,
      `Tasks fehlgeschlagen: ${stats.tasksFailed}`,
      `API-Kosten: $${stats.totalCostUsd.toFixed(4)}`,
      `Task-Typen: ${JSON.stringify(stats.topTaskTypes)}`,
      "",
      `== LEARNINGS (${lStats.learnings} gesamt) ==`,
      learnings || "(Keine Learnings)",
      "",
      `== FEHLER (${lStats.errors} gesamt) ==`,
      errors || "(Keine Fehler)",
      "",
      `== AKTUELLE ZIELE ==`,
      goals || "(Keine GOALS.md)",
      "",
      "Reflektiere über diesen Tag:",
      "1. Was lief gut? Was nicht?",
      "2. Welche Learnings sind bestätigt genug um promoted zu werden?",
      "3. Was soll morgen anders gemacht werden?",
      "4. Welche 3 konkreten Tasks für morgen priorisieren?",
    ].join("\n");
  }

  // ═══════════════════════════════════════════════════════════════
  //  RESULT PROCESSING
  // ═══════════════════════════════════════════════════════════════

  private parseReflection(text: string, date: string, costUsd: number): ReflectionResult {
    const defaultResult: ReflectionResult = {
      date,
      summary: "Keine Reflexion erstellt",
      achievements: [],
      improvements: [],
      tomorrowPlan: [],
      promotedLearnings: [],
      costUsd,
    };

    try {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
      const parsed = JSON.parse(jsonStr);

      return {
        date,
        summary: parsed.summary ?? defaultResult.summary,
        achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
        tomorrowPlan: Array.isArray(parsed.tomorrowPlan) ? parsed.tomorrowPlan : [],
        promotedLearnings: Array.isArray(parsed.promotedLearnings) ? parsed.promotedLearnings : [],
        costUsd,
      };
    } catch {
      return { ...defaultResult, summary: text.substring(0, 200) };
    }
  }

  private saveReflection(reflection: ReflectionResult): void {
    const dir = path.join(this.configDir, "reflections");
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${reflection.date}.json`);
    fs.writeFileSync(filePath, JSON.stringify(reflection, null, 2), "utf-8");

    // Also save as markdown
    const mdPath = path.join(dir, `${reflection.date}.md`);
    const md = [
      `# Tägliche Reflexion – ${reflection.date}`,
      "",
      `## Zusammenfassung`,
      reflection.summary,
      "",
      `## Erfolge`,
      ...reflection.achievements.map(a => `- ✅ ${a}`),
      "",
      `## Verbesserungen`,
      ...reflection.improvements.map(i => `- 📈 ${i}`),
      "",
      `## Plan für morgen`,
      ...reflection.tomorrowPlan.map(p => `- 🎯 ${p}`),
      "",
      `## Promoted Learnings`,
      ...(reflection.promotedLearnings.length > 0
        ? reflection.promotedLearnings.map(l => `- 🏆 ${l}`)
        : ["*(Keine)*"]),
      "",
      `---`,
      `Kosten dieser Reflexion: $${reflection.costUsd.toFixed(4)}`,
    ].join("\n");

    fs.writeFileSync(mdPath, md, "utf-8");
    this.log.exec(`📄 Reflexion gespeichert: ${filePath}`);
  }

  private promoteToSoul(learnings: string[]): void {
    const soulPath = path.join(this.configDir, "bootstrap", "SOUL.md");
    if (!fs.existsSync(soulPath)) return;

    try {
      let content = fs.readFileSync(soulPath, "utf-8");
      const marker = "*(Noch keine promoted Learnings)*";

      if (content.includes(marker)) {
        content = content.replace(marker, learnings.map(l => `- ${l}`).join("\n"));
      } else {
        // Append to Promoted Learnings section
        const sectionIdx = content.indexOf("## Promoted Learnings");
        if (sectionIdx !== -1) {
          content += "\n" + learnings.map(l => `- ${l}`).join("\n");
        }
      }

      fs.writeFileSync(soulPath, content, "utf-8");
      this.log.ok(`🏆 ${learnings.length} Learnings in SOUL.md promoted`);
    } catch (err) {
      this.log.error(`Promoting fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private updateGoalsFocus(plan: string[], date: string): void {
    const goalsPath = path.join(this.configDir, "GOALS.md");
    if (!fs.existsSync(goalsPath)) return;

    try {
      let content = fs.readFileSync(goalsPath, "utf-8");
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split("T")[0];

      // Replace the "Aktueller Fokus" section
      const focusIdx = content.indexOf("## Aktueller Fokus");
      if (focusIdx !== -1) {
        const nextSection = content.indexOf("\n## ", focusIdx + 1);
        const focusEnd = nextSection !== -1 ? nextSection : content.length;

        const newFocus = [
          "## Aktueller Fokus",
          "",
          `> Automatisch aktualisiert durch Tagesreflexion (${date})`,
          "",
          `**Morgen (${tomorrowStr})**:`,
          ...plan.map(p => `- ${p}`),
        ].join("\n");

        content = content.substring(0, focusIdx) + newFocus + content.substring(focusEnd);

        // Use BootstrapManager if available to keep in-memory cache in sync
        if (this.bootstrap) {
          this.bootstrap.updateFile("GOALS.md", content);
        } else {
          fs.writeFileSync(goalsPath, content, "utf-8");
        }
        this.log.ok("📋 GOALS.md Fokus aktualisiert");
      }
    } catch (err) {
      this.log.error(`GOALS.md Update fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async sendReflectionReport(reflection: ReflectionResult, stats: DailyStats): Promise<void> {
    if (!this.telegram) return;

    const lines = [
      `🌙 *Tägliche Reflexion – ${reflection.date}*`,
      "",
      reflection.summary,
      "",
      `📊 *Statistik:*`,
      `• ${stats.tasksCompleted} Tasks ✅ | ${stats.tasksFailed} ❌`,
      `• ${stats.cyclesRun} Zyklen | $${stats.totalCostUsd.toFixed(4)} Kosten`,
      "",
    ];

    if (reflection.achievements.length > 0) {
      lines.push("*Erfolge:*");
      for (const a of reflection.achievements.slice(0, 3)) {
        lines.push(`✅ ${a}`);
      }
      lines.push("");
    }

    if (reflection.tomorrowPlan.length > 0) {
      lines.push("*Plan für morgen:*");
      for (const p of reflection.tomorrowPlan.slice(0, 3)) {
        lines.push(`🎯 ${p}`);
      }
    }

    await this.telegram.sendToOperator(lines.join("\n"));
  }

  // ═══════════════════════════════════════════════════════════════
  //  STATE PERSISTENCE
  // ═══════════════════════════════════════════════════════════════

  private loadState(): void {
    const statePath = path.join(this.configDir, "reflection-state.json");
    try {
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        this.lastReflectionDate = state.lastReflectionDate ?? null;
      }
    } catch {
      // ignore
    }
  }

  private saveState(): void {
    const statePath = path.join(this.configDir, "reflection-state.json");
    fs.writeFileSync(
      statePath,
      JSON.stringify({ lastReflectionDate: this.lastReflectionDate }, null, 2),
      "utf-8",
    );
  }
}
