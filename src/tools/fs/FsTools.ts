// Filesystem Tools – fs.read, fs.write, fs.list, fs.exists, fs.mkdir
// Read-only tools are concurrency-safe and always allowed

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { ToolContext, ValidationResult } from "../Tool.js";

/** Validate that a path is within the workspace (hardened against symlink / traversal attacks) */
function validatePath(rawPath: string, ctx: ToolContext): ValidationResult & { resolved?: string } {
  // Reject null bytes (poison character)
  if (rawPath.includes("\0")) {
    return { valid: false, error: "Pfad enthält ungültige Zeichen", code: 1 };
  }

  const normalized = rawPath.replace(/^~\/\.cashclaw\//, "").replace(/\\/g, "/");
  const resolved = path.resolve(ctx.workspaceDir, normalized);

  // Normalize both paths for reliable comparison (case-insensitive on Windows)
  const workspaceNorm = path.resolve(ctx.workspaceDir) + path.sep;
  const resolvedNorm = path.resolve(resolved);

  // First check: the resolved path must start with the workspace dir
  if (!resolvedNorm.startsWith(workspaceNorm) && resolvedNorm !== workspaceNorm.slice(0, -1)) {
    return { valid: false, error: `Pfad außerhalb des Workspace: ${rawPath}`, code: 1 };
  }

  // Second check: if the path actually exists, resolve symlinks via realpath
  // This catches symlink-based escapes
  if (fs.existsSync(resolved)) {
    try {
      const real = fs.realpathSync(resolved);
      const realNorm = path.resolve(real);
      if (!realNorm.startsWith(workspaceNorm) && realNorm !== workspaceNorm.slice(0, -1)) {
        return { valid: false, error: `Symlink-Ziel außerhalb des Workspace: ${rawPath}`, code: 1 };
      }
    } catch {
      // realpathSync can fail for broken symlinks — reject
      return { valid: false, error: `Pfad nicht auflösbar: ${rawPath}`, code: 1 };
    }
  }

  return { valid: true, resolved };
}

// ─── fs.read ────────────────────────────────────────────────────

export const FsReadTool = buildTool({
  name: "fs.read",
  description: "Datei lesen",
  category: "filesystem",
  parameterDescription: "{ path } – Pfad zur Datei relativ zum Workspace",
  readOnly: true,
  concurrencySafe: true,

  inputSchema: z.object({
    path: z.string().describe("Dateipfad relativ zum Workspace (~/.cashclaw/)"),
  }),

  validateInput(input, ctx) {
    const check = validatePath(input.path, ctx);
    if (!check.valid) return check;
    if (!fs.existsSync(check.resolved!)) {
      return { valid: false, error: `Datei nicht gefunden: ${input.path}` };
    }
    // Prevent reading huge files
    const stat = fs.statSync(check.resolved!);
    if (stat.size > 5 * 1024 * 1024) {
      return { valid: false, error: `Datei zu groß: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max 5MB)` };
    }
    return { valid: true };
  },

  async call(input, ctx) {
    const start = Date.now();
    const check = validatePath(input.path, ctx);
    const content = fs.readFileSync(check.resolved!, "utf-8");
    return {
      data: content,
      meta: { durationMs: Date.now() - start },
    };
  },
});

// ─── fs.write ───────────────────────────────────────────────────

export const FsWriteTool = buildTool({
  name: "fs.write",
  description: "Datei schreiben",
  category: "filesystem",
  parameterDescription: "{ path, content } – Pfad und Inhalt der Datei",
  readOnly: false,
  concurrencySafe: false,

  inputSchema: z.object({
    path: z.string().describe("Dateipfad relativ zum Workspace"),
    content: z.string().describe("Inhalt der Datei"),
  }),

  validateInput(input, ctx) {
    return validatePath(input.path, ctx);
  },

  async call(input, ctx) {
    const start = Date.now();
    const check = validatePath(input.path, ctx);
    const filePath = check.resolved!;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, input.content, "utf-8");
    return {
      data: `Geschrieben: ${input.path}`,
      meta: { durationMs: Date.now() - start },
    };
  },
});

// ─── fs.list ────────────────────────────────────────────────────

export const FsListTool = buildTool({
  name: "fs.list",
  description: "Verzeichnis auflisten",
  category: "filesystem",
  parameterDescription: "{ path } – Pfad zum Verzeichnis",
  readOnly: true,
  concurrencySafe: true,

  inputSchema: z.object({
    path: z.string().describe("Verzeichnispfad relativ zum Workspace"),
  }),

  validateInput(input, ctx) {
    const check = validatePath(input.path, ctx);
    if (!check.valid) return check;
    if (!fs.existsSync(check.resolved!)) {
      return { valid: false, error: `Verzeichnis nicht gefunden: ${input.path}` };
    }
    return { valid: true };
  },

  async call(input, ctx) {
    const start = Date.now();
    const check = validatePath(input.path, ctx);
    const entries = fs.readdirSync(check.resolved!, { withFileTypes: true });
    const list = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? "dir" as const : "file" as const,
    }));
    return {
      data: list,
      meta: { durationMs: Date.now() - start },
    };
  },
});

// ─── fs.exists ──────────────────────────────────────────────────

export const FsExistsTool = buildTool({
  name: "fs.exists",
  description: "Prüfen ob Datei existiert",
  category: "filesystem",
  parameterDescription: "{ path } – Pfad zur Datei",
  readOnly: true,
  concurrencySafe: true,

  inputSchema: z.object({
    path: z.string().describe("Dateipfad relativ zum Workspace"),
  }),

  validateInput(input, ctx) {
    return validatePath(input.path, ctx);
  },

  async call(input, ctx) {
    const start = Date.now();
    const check = validatePath(input.path, ctx);
    return {
      data: fs.existsSync(check.resolved!),
      meta: { durationMs: Date.now() - start },
    };
  },
});

// ─── fs.mkdir ───────────────────────────────────────────────────

export const FsMkdirTool = buildTool({
  name: "fs.mkdir",
  description: "Verzeichnis erstellen",
  category: "filesystem",
  parameterDescription: "{ path } – Pfad zum neuen Verzeichnis",
  readOnly: false,
  concurrencySafe: false,

  inputSchema: z.object({
    path: z.string().describe("Verzeichnispfad relativ zum Workspace"),
  }),

  validateInput(input, ctx) {
    return validatePath(input.path, ctx);
  },

  async call(input, ctx) {
    const start = Date.now();
    const check = validatePath(input.path, ctx);
    fs.mkdirSync(check.resolved!, { recursive: true });
    return {
      data: `Erstellt: ${input.path}`,
      meta: { durationMs: Date.now() - start },
    };
  },
});
