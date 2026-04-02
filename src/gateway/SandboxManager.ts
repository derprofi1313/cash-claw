// SandboxManager – Decides which tools run in Docker sandbox vs host
// Manages sandbox lifecycle and provides graceful fallback

import path from "node:path";
import os from "node:os";
import type { GatewayLogger } from "./GatewayLogger.js";
import { DockerSandbox, type SandboxOptions, type SandboxResult } from "./DockerSandbox.js";
import type { CashClawConfig } from "../config/types.js";

/**
 * SandboxManager – routes tool execution through Docker sandbox or direct host.
 */
export class SandboxManager {
  private enabled = false;
  private dockerAvailable = false;
  private dockerVersion = "unknown";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private docker: any = null;
  private defaultOptions: Omit<SandboxOptions, "workdir">;
  private workspacePath: string;

  /** Tools that ALWAYS run sandboxed */
  private readonly SANDBOXED_TOOLS = [
    "execute_code",
    "run_script",
    "fs.write",
    "fs.delete",
    "fs.mkdir",
  ];

  /** Tool patterns that ALWAYS run sandboxed (wildcard matching) */
  private readonly SANDBOXED_PATTERNS = [
    /^browser\./,
  ];

  /** Tools that NEVER run sandboxed (need host access) */
  private readonly HOST_TOOLS = [
    "telegram.send",
    "telegram.sendButtons",
    "telegram.sendFile",
    "whatsapp.send",
    "llm.query",
    "sub_agent",
  ];

  /** Tool patterns that NEVER run sandboxed */
  private readonly HOST_PATTERNS = [
    /^stripe\./,
    /^gog\./,
    /^cron\./,
    /^learning\./,
    /^openclaw\./,
  ];

  constructor(
    private config: CashClawConfig,
    private log: GatewayLogger,
  ) {
    this.workspacePath = config.docker?.workspacePath
      ?? path.join(os.homedir(), ".cashclaw", "workspace");
    this.defaultOptions = {
      image: config.docker?.image ?? "cashclaw/sandbox:latest",
      memoryMB: config.docker?.memoryMB ?? 512,
      cpuQuota: (config.docker?.cpuPercent ?? 50) * 1000,
      timeoutMs: (config.docker?.timeoutSeconds ?? 30) * 1000,
      allowNetwork: config.docker?.allowNetwork ?? false,
      env: {},
    };
  }

  /**
   * Initialize the sandbox manager – check Docker availability.
   */
  async init(): Promise<void> {
    if (!this.config.docker?.enabled) {
      this.log.gateway("Docker-Sandboxing deaktiviert (config)");
      return;
    }

    try {
      const { default: Dockerode } = await import("dockerode");
      this.docker = new Dockerode();
      const info = await this.docker.version();
      this.dockerVersion = info.Version ?? "unknown";
      this.dockerAvailable = true;
      this.enabled = true;
      this.log.ok(`Docker verfügbar: v${this.dockerVersion}`);
    } catch {
      this.dockerAvailable = false;
      this.enabled = false;
      this.log.gateway("⚠ Docker nicht verfügbar. Sandbox Enforcement deaktiviert.");
      this.log.gateway("  Tools laufen direkt auf dem Host (weniger sicher).");
      this.log.gateway("  Install Docker: https://docs.docker.com/get-docker/");
    }
  }

  /**
   * Determine if a tool should be sandboxed.
   */
  shouldSandbox(toolName: string): boolean {
    if (!this.enabled) return false;

    // Check host-only tools first (these always run on host)
    if (this.HOST_TOOLS.includes(toolName)) return false;
    for (const pattern of this.HOST_PATTERNS) {
      if (pattern.test(toolName)) return false;
    }

    // Check explicitly sandboxed tools
    if (this.SANDBOXED_TOOLS.includes(toolName)) return true;
    for (const pattern of this.SANDBOXED_PATTERNS) {
      if (pattern.test(toolName)) return true;
    }

    // Default: sandbox unknown tools for safety
    return true;
  }

  /**
   * Execute code in the Docker sandbox.
   */
  async executeInSandbox(
    code: string,
    language: "javascript" | "python" | "bash",
    options?: Partial<SandboxOptions>,
  ): Promise<SandboxResult> {
    if (!this.docker || !this.enabled) {
      this.log.gateway("[WARN] Docker nicht verfügbar – Code wird NICHT ausgeführt");
      return {
        stdout: "",
        stderr: "Docker sandbox not available",
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
      };
    }

    const sandboxOptions = {
      ...this.defaultOptions,
      ...options,
      workdir: this.workspacePath,
    };

    const sandbox = new DockerSandbox(this.docker, sandboxOptions);

    // Map language names
    const langMap: Record<string, "node" | "python" | "bash"> = {
      javascript: "node",
      python: "python",
      bash: "bash",
    };

    return sandbox.runScript(code, langMap[language] ?? "bash");
  }

  /**
   * Run a raw command in the sandbox.
   */
  async runInSandbox(
    command: string[],
    options?: Partial<SandboxOptions>,
  ): Promise<SandboxResult> {
    if (!this.docker || !this.enabled) {
      this.log.gateway("[WARN] Docker nicht verfügbar – Befehl wird NICHT ausgeführt");
      return {
        stdout: "",
        stderr: "Docker sandbox not available",
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
      };
    }

    const sandboxOptions = {
      ...this.defaultOptions,
      ...options,
      workdir: this.workspacePath,
    };

    const sandbox = new DockerSandbox(this.docker, sandboxOptions);
    return sandbox.run(command);
  }

  /**
   * Get the current Docker/sandbox status.
   */
  async getDockerStatus(): Promise<{
    available: boolean;
    version: string;
    enabled: boolean;
    image: string;
    memoryMB: number;
    cpuPercent: number;
    timeoutSeconds: number;
  }> {
    return {
      available: this.dockerAvailable,
      version: this.dockerVersion,
      enabled: this.enabled,
      image: this.defaultOptions.image,
      memoryMB: this.defaultOptions.memoryMB,
      cpuPercent: this.defaultOptions.cpuQuota / 1000,
      timeoutSeconds: this.defaultOptions.timeoutMs / 1000,
    };
  }

  /** Whether sandbox enforcement is currently active */
  isEnabled(): boolean {
    return this.enabled;
  }
}
