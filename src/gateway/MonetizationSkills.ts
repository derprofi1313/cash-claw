// MonetizationSkills – Vordefinierte Monetarisierungs-Workflows (Phase 5)
// Jeder Skill ist ein strukturierter Workflow den der Agent ausführen kann

import type { GatewayLogger } from "./GatewayLogger.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { LLMAdapter } from "./LLMAdapter.js";

/** Tool call reference used in skill step definitions (no id needed) */
interface SkillToolCall {
  tool: string;
  params: Record<string, unknown>;
}

export interface SkillStep {
  name: string;
  tool?: SkillToolCall;
  llmPrompt?: string;
  dependsOn?: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  category: "content" | "outreach" | "products" | "finance";
  description: string;
  estimatedMinutes: number;
  estimatedRevenue: string;
  steps: SkillStep[];
}

export interface SkillResult {
  skillId: string;
  success: boolean;
  stepsCompleted: number;
  stepsTotal: number;
  outputs: Record<string, string>;
  costUsd: number;
  error?: string;
}

export class MonetizationSkills {
  private skills: Map<string, SkillDefinition> = new Map();

  constructor(
    private log: GatewayLogger,
    private registry: ToolRegistry,
    private llm: LLMAdapter,
  ) {
    this.registerBuiltinSkills();
  }

  /** Get all available skills */
  getSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /** Get skills for a category */
  getByCategory(category: string): SkillDefinition[] {
    return this.getSkills().filter(s => s.category === category);
  }

  /** Get a skill by ID */
  getSkill(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  /** Execute a skill workflow */
  async execute(
    skillId: string,
    params: Record<string, string> = {},
  ): Promise<SkillResult> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        skillId,
        success: false,
        stepsCompleted: 0,
        stepsTotal: 0,
        outputs: {},
        costUsd: 0,
        error: `Skill '${skillId}' nicht gefunden`,
      };
    }

    this.log.exec(`🎯 Skill gestartet: ${skill.name}`);
    const outputs: Record<string, string> = { ...params };
    let totalCost = 0;
    let stepsCompleted = 0;

    for (const step of skill.steps) {
      this.log.exec(`   📌 ${step.name}`);

      try {
        // LLM step
        if (step.llmPrompt) {
          // Interpolate variables in the prompt
          let prompt = step.llmPrompt;
          for (const [key, val] of Object.entries(outputs)) {
            prompt = prompt.replace(`{${key}}`, val);
          }

          const response = await this.llm.send(
            [{ role: "user", content: prompt }],
            "Du bist ein professioneller Assistent. Liefere direkt das Ergebnis ohne Einleitung.",
          );
          totalCost += response.costUsd;
          outputs[step.name] = response.text;
        }

        // Tool step
        if (step.tool) {
          // Interpolate params
          const interpolatedParams: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(step.tool.params)) {
            if (typeof val === "string") {
              let interpolated = val;
              for (const [oKey, oVal] of Object.entries(outputs)) {
                interpolated = interpolated.replace(`{${oKey}}`, oVal);
              }
              interpolatedParams[key] = interpolated;
            } else {
              interpolatedParams[key] = val;
            }
          }

          const result = await this.registry.execute(
            {
              id: `skill-${skillId}-${stepsCompleted}`,
              tool: step.tool.tool,
              params: interpolatedParams,
            },
            { workspaceDir: ".", permissionMode: "autonomous", getState: () => ({ running: true, paused: false, actionsToday: 0, costToday: 0, dailyBudgetUsd: 5, cycleCount: 0 }) },
          );

          if (!result.success) {
            this.log.error(`   ❌ Step fehlgeschlagen: ${result.error}`);
            return {
              skillId,
              success: false,
              stepsCompleted,
              stepsTotal: skill.steps.length,
              outputs,
              costUsd: totalCost,
              error: `Step '${step.name}': ${result.error}`,
            };
          }

          outputs[step.name] = result.output;
        }

        stepsCompleted++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log.error(`   ❌ Step '${step.name}': ${errMsg}`);
        return {
          skillId,
          success: false,
          stepsCompleted,
          stepsTotal: skill.steps.length,
          outputs,
          costUsd: totalCost,
          error: errMsg,
        };
      }
    }

    this.log.ok(`✅ Skill '${skill.name}' abgeschlossen (${stepsCompleted}/${skill.steps.length} Steps)`);
    return {
      skillId,
      success: true,
      stepsCompleted,
      stepsTotal: skill.steps.length,
      outputs,
      costUsd: totalCost,
    };
  }

  /** Get skills description for the agent's system prompt */
  getSkillsDescription(): string {
    const lines = ["== MONETARISIERUNGS-SKILLS ==", ""];
    for (const skill of this.skills.values()) {
      lines.push(
        `- **${skill.id}**: ${skill.name} (${skill.category}) – ${skill.description}`,
        `  Dauer: ~${skill.estimatedMinutes}min | Ertrag: ${skill.estimatedRevenue}`,
      );
    }
    return lines.join("\n");
  }

  // ═══════════════════════════════════════════════════════════════
  //  BUILT-IN SKILLS
  // ═══════════════════════════════════════════════════════════════

  private registerBuiltinSkills(): void {
    // ── CONTENT ──────────────────────────────────────────
    this.skills.set("blog-post", {
      id: "blog-post",
      name: "Blog-Post schreiben",
      category: "content",
      description: "SEO-optimierten Blog-Post zu einem Thema erstellen und als Datei speichern",
      estimatedMinutes: 10,
      estimatedRevenue: "€5-10",
      steps: [
        {
          name: "research",
          llmPrompt: "Recherchiere zum Thema '{topic}'. Liste 5 relevante Keywords, 3 Wettbewerber-Artikel und eine Gliederung mit H2/H3.",
        },
        {
          name: "write",
          llmPrompt: "Schreibe einen SEO-optimierten Blog-Post (1500+ Wörter) zum Thema '{topic}'. Nutze die Recherche:\n{research}\n\nFormat: Markdown mit H1, H2, H3, Bullet-Points, Meta-Description.",
        },
        {
          name: "save",
          tool: {
            tool: "fs.write",
            params: { path: "content/blog-{topic}.md", content: "{write}" },
          },
        },
      ],
    });

    this.skills.set("newsletter", {
      id: "newsletter",
      name: "Newsletter erstellen",
      category: "content",
      description: "Professionellen Newsletter für E-Mail-Versand verfassen",
      estimatedMinutes: 8,
      estimatedRevenue: "€7",
      steps: [
        {
          name: "draft",
          llmPrompt: "Erstelle einen professionellen Newsletter zum Thema '{topic}'. Zielgruppe: '{audience}'. Format: HTML-freundlich, kurze Absätze, CTA am Ende. Max 500 Wörter.",
        },
        {
          name: "save",
          tool: {
            tool: "fs.write",
            params: { path: "content/newsletter-{topic}.md", content: "{draft}" },
          },
        },
      ],
    });

    // ── OUTREACH ─────────────────────────────────────────
    this.skills.set("cold-email-batch", {
      id: "cold-email-batch",
      name: "Cold-Email Batch",
      category: "outreach",
      description: "Personalisierte Cold-Emails an eine Lead-Liste senden",
      estimatedMinutes: 15,
      estimatedRevenue: "€6-25",
      steps: [
        {
          name: "template",
          llmPrompt: "Erstelle eine personalisierte Cold-Email-Vorlage für '{service}'. Zielgruppe: '{industry}'. Die E-Mail soll: kurz sein (max 150 Wörter), einen klaren Nutzen kommunizieren, einen CTA haben. Variablen: {name}, {company}, {pain_point}.",
        },
        {
          name: "personalize",
          llmPrompt: "Personalisiere diese E-Mail-Vorlage für den Lead '{leadName}' bei '{leadCompany}':\n\n{template}\n\nMache sie spezifisch und nicht generisch.",
        },
        {
          name: "send",
          tool: {
            tool: "gog.gmail.send",
            params: { to: "{leadEmail}", subject: "{subject}", body: "{personalize}" },
          },
        },
        {
          name: "log",
          tool: {
            tool: "learning.log",
            params: { category: "outreach", content: "Cold-Email an {leadName} ({leadCompany}) gesendet" },
          },
        },
      ],
    });

    this.skills.set("lead-research", {
      id: "lead-research",
      name: "Lead-Recherche",
      category: "outreach",
      description: "Potenzielle Kunden online recherchieren und Kontaktdaten sammeln",
      estimatedMinutes: 20,
      estimatedRevenue: "€6-25",
      steps: [
        {
          name: "search",
          tool: {
            tool: "browser.open",
            params: { url: "https://www.google.com/search?q={query}+{industry}+{location}" },
          },
        },
        {
          name: "scan",
          tool: {
            tool: "browser.snapshot",
            params: {},
          },
        },
        {
          name: "analyze",
          llmPrompt: "Analysiere diese Suchergebnisse und extrahiere potenzielle Leads:\n{scan}\n\nFür jeden Lead: Name, Firma, Branche, geschätzte Unternehmensgröße, Website.",
        },
        {
          name: "save",
          tool: {
            tool: "fs.write",
            params: { path: "leads/batch-{date}.md", content: "{analyze}" },
          },
        },
      ],
    });

    // ── SEO AUDIT ────────────────────────────────────────
    this.skills.set("seo-audit", {
      id: "seo-audit",
      name: "SEO Audit",
      category: "outreach",
      description: "Website SEO-Audit durchführen und Bericht erstellen",
      estimatedMinutes: 15,
      estimatedRevenue: "€10-55",
      steps: [
        {
          name: "open-site",
          tool: {
            tool: "browser.open",
            params: { url: "{url}" },
          },
        },
        {
          name: "snapshot",
          tool: {
            tool: "browser.snapshot",
            params: {},
          },
        },
        {
          name: "analyze",
          llmPrompt: "Führe einen SEO-Audit für die Website '{url}' durch. Snapshot:\n{snapshot}\n\nPrüfe: Title Tags, Meta Descriptions, H1-Struktur, Mobile-Readiness, Ladezeit-Indikatoren, Content-Qualität, interne Verlinkung. Erstelle einen professionellen Bericht mit Bewertung (1-100) und konkreten Empfehlungen.",
        },
        {
          name: "save",
          tool: {
            tool: "fs.write",
            params: { path: "deliverables/seo-audit-{date}.md", content: "{analyze}" },
          },
        },
      ],
    });

    // ── PRODUCTS ──────────────────────────────────────────
    this.skills.set("digital-product", {
      id: "digital-product",
      name: "Digitales Produkt erstellen",
      category: "products",
      description: "E-Book, Template oder Guide erstellen und Stripe Payment Link anlegen",
      estimatedMinutes: 30,
      estimatedRevenue: "€5-35",
      steps: [
        {
          name: "outline",
          llmPrompt: "Erstelle eine detaillierte Gliederung für ein digitales Produkt: '{productName}'. Typ: {productType}. Zielgruppe: {audience}. Max 10 Kapitel/Abschnitte.",
        },
        {
          name: "content",
          llmPrompt: "Schreibe den vollständigen Inhalt für das Produkt '{productName}' basierend auf der Gliederung:\n{outline}\n\nSchreibe professionell, detailliert und praxisnah. Min 3000 Wörter.",
        },
        {
          name: "save",
          tool: {
            tool: "fs.write",
            params: { path: "products/{productName}.md", content: "{content}" },
          },
        },
        {
          name: "log",
          tool: {
            tool: "learning.log",
            params: { category: "products", content: "Produkt '{productName}' erstellt und gespeichert" },
          },
        },
      ],
    });

    // ── COMPETITOR ANALYSIS ──────────────────────────────
    this.skills.set("competitor-analysis", {
      id: "competitor-analysis",
      name: "Wettbewerber-Analyse",
      category: "outreach",
      description: "Wettbewerber-Website analysieren und Bericht erstellen",
      estimatedMinutes: 15,
      estimatedRevenue: "€15-45",
      steps: [
        {
          name: "open",
          tool: {
            tool: "browser.open",
            params: { url: "{competitorUrl}" },
          },
        },
        {
          name: "snapshot",
          tool: {
            tool: "browser.snapshot",
            params: {},
          },
        },
        {
          name: "analyze",
          llmPrompt: "Führe eine Wettbewerber-Analyse durch für '{competitorUrl}'. Snapshot:\n{snapshot}\n\nAnalysiere: Angebot, Preise, USPs, Stärken, Schwächen, SEO, Design, Content-Strategie. Erstelle einen professionellen Bericht.",
        },
        {
          name: "save",
          tool: {
            tool: "fs.write",
            params: { path: "deliverables/competitor-{date}.md", content: "{analyze}" },
          },
        },
      ],
    });

    // ── SOCIAL MEDIA ─────────────────────────────────────
    this.skills.set("social-media-batch", {
      id: "social-media-batch",
      name: "Social Media Content Batch",
      category: "content",
      description: "Batch von Social-Media-Posts für verschiedene Plattformen erstellen",
      estimatedMinutes: 10,
      estimatedRevenue: "€7-15",
      steps: [
        {
          name: "create",
          llmPrompt: "Erstelle 5 Social-Media-Posts für '{platform}' zum Thema '{topic}'. Zielgruppe: '{audience}'. Für jeden Post: Text, Hashtags, bester Zeitpunkt zum Posten. Platform-spezifisch (LinkedIn: professionell, Instagram: visuell, Twitter: kurz+punchy).",
        },
        {
          name: "save",
          tool: {
            tool: "fs.write",
            params: { path: "content/social-{platform}-{topic}.md", content: "{create}" },
          },
        },
      ],
    });

    this.log.ok(`📦 ${this.skills.size} Monetarisierungs-Skills registriert`);
  }
}
