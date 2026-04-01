// LearningSystem – Self-improving agent with structured learning
// Maintains .learnings/ directory with LEARNINGS.md, ERRORS.md, FEATURE_REQUESTS.md

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GatewayLogger } from "./GatewayLogger.js";

export interface LearningEntry {
  id: string;
  date: string;
  category: string;
  content: string;
  confirmations: number;
}

export interface ErrorEntry {
  id: string;
  date: string;
  context: string;
  error: string;
  solution: string;
  resolved: boolean;
}

export class LearningSystem {
  private learningsDir: string;
  private learningsPath: string;
  private errorsPath: string;
  private featuresPath: string;
  private nextLearningId = 1;
  private nextErrorId = 1;
  private nextFeatureId = 1;

  constructor(private log: GatewayLogger) {
    this.learningsDir = path.join(os.homedir(), ".cashclaw", ".learnings");
    this.learningsPath = path.join(this.learningsDir, "LEARNINGS.md");
    this.errorsPath = path.join(this.learningsDir, "ERRORS.md");
    this.featuresPath = path.join(this.learningsDir, "FEATURE_REQUESTS.md");
  }

  /** Initialize the .learnings/ directory if it doesn't exist */
  init(): void {
    if (!fs.existsSync(this.learningsDir)) {
      fs.mkdirSync(this.learningsDir, { recursive: true });
      this.log.ok(".learnings/ Verzeichnis erstellt");
    }

    if (!fs.existsSync(this.learningsPath)) {
      fs.writeFileSync(this.learningsPath, "# Learnings\n\nBestätigte Erkenntnisse des Agenten.\n\n", "utf-8");
    }
    if (!fs.existsSync(this.errorsPath)) {
      fs.writeFileSync(this.errorsPath, "# Errors\n\nFehler und ihre Lösungen.\n\n", "utf-8");
    }
    if (!fs.existsSync(this.featuresPath)) {
      fs.writeFileSync(this.featuresPath, "# Feature Requests\n\nTools und Fähigkeiten die der Agent gerne hätte.\n\n", "utf-8");
    }

    // Parse existing IDs
    this.nextLearningId = this.getNextId(this.learningsPath, "LRN");
    this.nextErrorId = this.getNextId(this.errorsPath, "ERR");
    this.nextFeatureId = this.getNextId(this.featuresPath, "FEAT");

    this.log.ok(`Lernsystem geladen: ${this.nextLearningId - 1} Learnings, ${this.nextErrorId - 1} Errors, ${this.nextFeatureId - 1} Features`);
  }

  /** Log a new learning */
  logLearning(category: string, content: string): string {
    const id = `LRN-${String(this.nextLearningId++).padStart(3, "0")}`;
    const date = new Date().toISOString().split("T")[0];
    const entry = `[${id}] [${date}] ${category}: ${content}\n`;

    fs.appendFileSync(this.learningsPath, entry, "utf-8");
    this.log.ok(`📚 ${id} gespeichert: ${content.substring(0, 80)}`);
    return id;
  }

  /** Log an error with solution */
  logError(context: string, error: string, solution?: string): string {
    const id = `ERR-${String(this.nextErrorId++).padStart(3, "0")}`;
    const date = new Date().toISOString().split("T")[0];
    const solutionText = solution ? ` → Lösung: ${solution}` : " → Noch keine Lösung";
    const entry = `[${id}] [${date}] ${context}: ${error}${solutionText}\n`;

    fs.appendFileSync(this.errorsPath, entry, "utf-8");
    this.log.error(`📝 ${id} geloggt: ${error.substring(0, 80)}`);
    return id;
  }

  /** Log a feature request */
  logFeature(description: string, reason: string): string {
    const id = `FEAT-${String(this.nextFeatureId++).padStart(3, "0")}`;
    const date = new Date().toISOString().split("T")[0];
    const entry = `[${id}] [${date}] ${description} – Grund: ${reason}\n`;

    fs.appendFileSync(this.featuresPath, entry, "utf-8");
    this.log.gateway(`💡 ${id}: ${description}`);
    return id;
  }

  /** Recall relevant learnings for a given context */
  recallLearnings(context: string): string[] {
    if (!fs.existsSync(this.learningsPath)) return [];

    const content = fs.readFileSync(this.learningsPath, "utf-8");
    const lines = content.split("\n").filter(l => l.startsWith("[LRN-"));
    const keywords = context.toLowerCase().split(/\s+/);

    return lines.filter(line => {
      const lower = line.toLowerCase();
      return keywords.some(kw => kw.length > 3 && lower.includes(kw));
    });
  }

  /** Promote a confirmed learning to SOUL.md bootstrap file */
  promoteLearning(learningId: string, targetFile: "SOUL" | "TOOLS" = "SOUL"): { success: boolean; message: string } {
    // Find the learning entry
    if (!fs.existsSync(this.learningsPath)) {
      return { success: false, message: `Learnings-Datei nicht gefunden` };
    }
    const content = fs.readFileSync(this.learningsPath, "utf-8");
    const lines = content.split("\n");
    const entry = lines.find(l => l.includes(`[${learningId}]`));

    if (!entry) {
      return { success: false, message: `Learning '${learningId}' nicht gefunden` };
    }

    // Determine target bootstrap file
    const bootstrapDir = path.join(os.homedir(), ".cashclaw", "bootstrap");
    const targetPath = path.join(bootstrapDir, `${targetFile}.md`);

    if (!fs.existsSync(targetPath)) {
      return { success: false, message: `Bootstrap-Datei ${targetFile}.md nicht gefunden` };
    }

    // Extract the actual content from the entry (after category:)
    const match = entry.match(/\] [^:]+: (.+)$/);
    const learningText = match ? match[1] : entry;

    // Append to the "Promoted Learnings" section
    const date = new Date().toISOString().split("T")[0];
    const promotion = `\n- [${date}] [${learningId}] ${learningText}`;

    const targetContent = fs.readFileSync(targetPath, "utf-8");
    if (targetContent.includes("## Promoted Learnings")) {
      // Append to existing section
      const updated = targetContent.replace(
        /## Promoted Learnings/,
        `## Promoted Learnings${promotion}`,
      );
      fs.writeFileSync(targetPath, updated, "utf-8");
    } else {
      // Create new section at end
      fs.appendFileSync(targetPath, `\n\n## Promoted Learnings${promotion}\n`, "utf-8");
    }

    this.log.ok(`📈 ${learningId} promoted nach ${targetFile}.md`);
    return { success: true, message: `${learningId} → ${targetFile}.md promoted` };
  }

  /** Recall errors for a given context (to avoid repeating) */
  recallErrors(context: string): string[] {
    if (!fs.existsSync(this.errorsPath)) return [];

    const content = fs.readFileSync(this.errorsPath, "utf-8");
    const lines = content.split("\n").filter(l => l.startsWith("[ERR-"));
    const keywords = context.toLowerCase().split(/\s+/);

    return lines.filter(line => {
      const lower = line.toLowerCase();
      return keywords.some(kw => kw.length > 3 && lower.includes(kw));
    });
  }

  /** Get all learnings as text for system prompt injection */
  getAllLearnings(): string {
    if (!fs.existsSync(this.learningsPath)) return "";
    return fs.readFileSync(this.learningsPath, "utf-8");
  }

  /** Get all errors as text */
  getAllErrors(): string {
    if (!fs.existsSync(this.errorsPath)) return "";
    return fs.readFileSync(this.errorsPath, "utf-8");
  }

  /** Get summary stats */
  getStats(): { learnings: number; errors: number; features: number } {
    return {
      learnings: this.nextLearningId - 1,
      errors: this.nextErrorId - 1,
      features: this.nextFeatureId - 1,
    };
  }

  /** Parse existing IDs to find the next available number */
  private getNextId(filePath: string, prefix: string): number {
    if (!fs.existsSync(filePath)) return 1;

    const content = fs.readFileSync(filePath, "utf-8");
    const regex = new RegExp(`\\[${prefix}-(\\d+)\\]`, "g");
    let maxId = 0;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const id = parseInt(match[1], 10);
      if (id > maxId) maxId = id;
    }

    return maxId + 1;
  }
}
