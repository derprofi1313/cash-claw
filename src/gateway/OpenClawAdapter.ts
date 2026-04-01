import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { CashClawConfig } from "../config/types.js";

export interface OpenClawSkillInfo {
  id: string;
  sourcePath: string;
  sourceType: "workspace" | "agent-skill" | "installed";
  hasSkillFile: boolean;
  title?: string;
  description?: string;
}

export interface SkillInstallResult {
  success: boolean;
  skill: string;
  message: string;
  installedPath?: string;
  sourcePath?: string;
  sourceType?: "workspace" | "agent-skill" | "clawhub" | "already-installed";
}

export interface OpenClawAdapterLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export const DEFAULT_STANDARD_SKILLS = [
  "clawhub",
  "gog",
  "skill-creator",
  "model-usage",
] as const;

export class OpenClawAdapter {
  private workspaceRoot: string | null;

  constructor(
    private readonly config: CashClawConfig,
    private readonly logger?: OpenClawAdapterLogger,
  ) {
    this.workspaceRoot = this.detectWorkspace();
  }

  refreshDetection(): void {
    this.workspaceRoot = this.detectWorkspace();
  }

  getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

  getInstallRoot(): string {
    const configured = this.config.openclaw?.install_dir?.trim();
    if (configured) {
      return path.resolve(configured);
    }
    return path.join(os.homedir(), ".codex", "skills");
  }

  getSourceRoots(): Array<{ root: string; sourceType: "workspace" | "agent-skill" }> {
    const roots: Array<{ root: string; sourceType: "workspace" | "agent-skill" }> = [];

    const configuredSkillsDir = this.config.openclaw?.skills_dir?.trim();
    if (configuredSkillsDir) {
      roots.push({ root: path.resolve(configuredSkillsDir), sourceType: "workspace" });
    }

    const workspace = this.workspaceRoot;
    if (workspace) {
      roots.push({ root: path.join(workspace, "skills"), sourceType: "workspace" });
      roots.push({ root: path.join(workspace, ".agents", "skills"), sourceType: "agent-skill" });
    }

    const seen = new Set<string>();
    return roots
      .map(entry => ({
        root: path.resolve(entry.root),
        sourceType: entry.sourceType,
      }))
      .filter(entry => {
        if (!this.isDirectory(entry.root)) return false;
        const norm = path.normalize(entry.root).toLowerCase();
        if (seen.has(norm)) return false;
        seen.add(norm);
        return true;
      });
  }

  listAvailableSkills(query = ""): OpenClawSkillInfo[] {
    const items = this.discoverFromSources();
    return this.filterByQuery(items, query);
  }

  listInstalledSkills(query = ""): OpenClawSkillInfo[] {
    const installRoot = this.getInstallRoot();
    if (!this.isDirectory(installRoot)) return [];

    const items = this.readSkillsFromRoot(installRoot, "installed");
    return this.filterByQuery(items, query);
  }

  readSkillMarkdown(skillRequest: string, preferInstalled = true): { skill: OpenClawSkillInfo; content: string } | null {
    const skill = this.resolveSkill(skillRequest, preferInstalled);
    if (!skill) return null;

    const skillMdPath = path.join(skill.sourcePath, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) return null;

    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      return { skill, content };
    } catch {
      return null;
    }
  }

  installSkill(
    skillRequest: string,
    opts?: { force?: boolean; source?: "auto" | "workspace" | "clawhub"; allowClawhubFallback?: boolean },
  ): SkillInstallResult {
    const request = skillRequest.trim();
    if (!request) {
      return { success: false, skill: "", message: "Kein Skill-Name angegeben." };
    }

    const force = opts?.force === true;
    const sourceMode = opts?.source ?? "auto";
    const allowClawhubFallback = opts?.allowClawhubFallback !== false;

    const installed = this.resolveInstalledSkill(request);
    if (installed && !force) {
      return {
        success: true,
        skill: installed.id,
        message: `Skill '${installed.id}' ist bereits installiert.`,
        installedPath: installed.sourcePath,
        sourcePath: installed.sourcePath,
        sourceType: "already-installed",
      };
    }

    const sourceSkill = sourceMode === "clawhub" ? null : this.resolveAvailableSkill(request);
    if (sourceSkill && sourceMode !== "clawhub") {
      const installRoot = this.getInstallRoot();
      fs.mkdirSync(installRoot, { recursive: true });

      const targetPath = path.join(installRoot, sourceSkill.id);
      if (fs.existsSync(targetPath) && force) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }

      fs.cpSync(sourceSkill.sourcePath, targetPath, { recursive: true, force: true });
      const sourceType = sourceSkill.sourceType === "agent-skill" ? "agent-skill" : "workspace";
      this.logger?.info?.(`OpenClaw Skill installiert: ${sourceSkill.id} -> ${targetPath}`);
      return {
        success: true,
        skill: sourceSkill.id,
        message: `Skill '${sourceSkill.id}' wurde installiert.`,
        installedPath: targetPath,
        sourcePath: sourceSkill.sourcePath,
        sourceType,
      };
    }

    if (sourceMode === "workspace") {
      return {
        success: false,
        skill: request,
        message: `Skill '${request}' wurde im OpenClaw-Workspace nicht gefunden.`,
      };
    }

    if (!allowClawhubFallback) {
      return {
        success: false,
        skill: request,
        message: `Skill '${request}' wurde lokal nicht gefunden und ClawHub-Fallback ist deaktiviert.`,
      };
    }

    return this.installViaClawHub(request);
  }

  private installViaClawHub(skillRequest: string): SkillInstallResult {
    if (!this.isClawHubAvailable()) {
      return {
        success: false,
        skill: skillRequest,
        message: "ClawHub CLI ist nicht installiert. Installiere zuerst 'clawhub' oder nutze lokale OpenClaw-Skills.",
      };
    }

    const installRoot = this.getInstallRoot();
    const workdir = path.dirname(installRoot);
    fs.mkdirSync(installRoot, { recursive: true });

    const result = spawnSync("clawhub", ["install", skillRequest], {
      cwd: workdir,
      encoding: "utf-8",
      timeout: 120_000,
    });

    if (result.error) {
      this.logger?.error?.(`ClawHub install failed: ${result.error.message}`);
      return {
        success: false,
        skill: skillRequest,
        message: `ClawHub-Installation fehlgeschlagen: ${result.error.message}`,
      };
    }

    if (result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      return {
        success: false,
        skill: skillRequest,
        message: stderr || "ClawHub konnte den Skill nicht installieren.",
      };
    }

    const installed = this.resolveInstalledSkill(skillRequest);
    if (!installed) {
      return {
        success: true,
        skill: skillRequest,
        message: "ClawHub meldet Erfolg, aber der installierte Skill-Ordner konnte nicht eindeutig erkannt werden.",
      };
    }

    return {
      success: true,
      skill: installed.id,
      message: `Skill '${installed.id}' wurde ueber ClawHub installiert.`,
      installedPath: installed.sourcePath,
      sourcePath: installed.sourcePath,
      sourceType: "clawhub",
    };
  }

  private isClawHubAvailable(): boolean {
    const check = spawnSync("clawhub", ["--help"], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    return !check.error && check.status === 0;
  }

  private resolveSkill(skillRequest: string, preferInstalled: boolean): OpenClawSkillInfo | null {
    if (preferInstalled) {
      return this.resolveInstalledSkill(skillRequest) ?? this.resolveAvailableSkill(skillRequest);
    }
    return this.resolveAvailableSkill(skillRequest) ?? this.resolveInstalledSkill(skillRequest);
  }

  private resolveInstalledSkill(skillRequest: string): OpenClawSkillInfo | null {
    const installed = this.listInstalledSkills();
    return this.findBestMatch(installed, skillRequest);
  }

  private resolveAvailableSkill(skillRequest: string): OpenClawSkillInfo | null {
    const available = this.listAvailableSkills();
    return this.findBestMatch(available, skillRequest);
  }

  private findBestMatch(skills: OpenClawSkillInfo[], request: string): OpenClawSkillInfo | null {
    if (skills.length === 0) return null;

    const key = this.normalizeSkillRequest(request);
    const exact = skills.find(skill => this.normalizeKey(skill.id) === key);
    if (exact) return exact;

    const exactByTitle = skills.find(skill => this.normalizeKey(skill.title ?? "") === key);
    if (exactByTitle) return exactByTitle;

    const contains = skills.find(skill => this.normalizeKey(skill.id).includes(key) || key.includes(this.normalizeKey(skill.id)));
    if (contains) return contains;

    const titleContains = skills.find(skill => this.normalizeKey(skill.title ?? "").includes(key));
    if (titleContains) return titleContains;

    return null;
  }

  private discoverFromSources(): OpenClawSkillInfo[] {
    const merged = new Map<string, OpenClawSkillInfo>();
    const sourceRoots = this.getSourceRoots();

    for (const sourceEntry of sourceRoots) {
      const skills = this.readSkillsFromRoot(sourceEntry.root, sourceEntry.sourceType);

      for (const skill of skills) {
        const key = this.normalizeKey(skill.id);
        if (!merged.has(key)) {
          merged.set(key, skill);
        }
      }
    }

    return Array.from(merged.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  private readSkillsFromRoot(root: string, sourceType: OpenClawSkillInfo["sourceType"]): OpenClawSkillInfo[] {
    if (!this.isDirectory(root)) return [];

    const output: OpenClawSkillInfo[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(root, entry.name);
      const skillMd = path.join(skillDir, "SKILL.md");
      const hasSkillFile = fs.existsSync(skillMd);
      if (!hasSkillFile) continue;

      const parsed = this.parseFrontmatter(skillMd);
      output.push({
        id: entry.name,
        sourcePath: skillDir,
        sourceType,
        hasSkillFile,
        title: parsed.title,
        description: parsed.description,
      });
    }

    return output;
  }

  private filterByQuery(items: OpenClawSkillInfo[], query: string): OpenClawSkillInfo[] {
    const q = query.trim();
    if (!q) {
      return [...items].sort((a, b) => a.id.localeCompare(b.id));
    }
    const qKey = this.normalizeKey(q);
    return items
      .filter(item => {
        const inId = this.normalizeKey(item.id).includes(qKey);
        const inTitle = this.normalizeKey(item.title ?? "").includes(qKey);
        const inDesc = this.normalizeKey(item.description ?? "").includes(qKey);
        return inId || inTitle || inDesc;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private parseFrontmatter(skillMdPath: string): { title?: string; description?: string } {
    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const match = content.match(/^---\s*([\s\S]*?)\s*---/);
      if (!match) return {};

      const lines = match[1].split(/\r?\n/);
      const title = this.extractFrontmatterValue(lines, "name");
      const description = this.extractFrontmatterValue(lines, "description");
      return { title, description };
    } catch {
      return {};
    }
  }

  private extractFrontmatterValue(lines: string[], key: string): string | undefined {
    const pattern = new RegExp(`^${key}:\\s*(.+)$`, "i");
    for (const line of lines) {
      const match = line.match(pattern);
      if (match && match[1]) {
        return match[1].trim().replace(/^["']|["']$/g, "");
      }
    }
    return undefined;
  }

  private detectWorkspace(): string | null {
    const configuredWorkspace = this.config.openclaw?.workspace?.trim();
    const candidates = new Set<string>();
    if (configuredWorkspace) {
      candidates.add(path.resolve(configuredWorkspace));
    }

    candidates.add(path.resolve(process.cwd(), "openclaw-source"));
    candidates.add(path.resolve(process.cwd()));
    candidates.add(path.join(os.homedir(), ".openclaw"));
    candidates.add(path.join(os.homedir(), "openclaw"));

    for (const candidate of candidates) {
      const hasSkills = this.isDirectory(path.join(candidate, "skills"));
      const hasAgentSkills = this.isDirectory(path.join(candidate, ".agents", "skills"));
      if (hasSkills || hasAgentSkills) {
        return candidate;
      }
    }

    this.logger?.warn?.("Kein OpenClaw Workspace erkannt.");
    return null;
  }

  private normalizeSkillRequest(input: string): string {
    const raw = input.trim().toLowerCase();
    const cleaned = raw.replace(/^skill[:\s-]*/i, "");
    const segments = cleaned.split(/[\\/]/).filter(Boolean);
    return this.normalizeKey(segments[segments.length - 1] ?? cleaned);
  }

  private normalizeKey(input: string): string {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");
  }

  private isDirectory(dirPath: string): boolean {
    try {
      return fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }
}
