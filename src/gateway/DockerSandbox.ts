// DockerSandbox – Isolated container execution for tool safety
// Runs commands in ephemeral Docker containers with strict resource limits

import type { GatewayLogger } from "./GatewayLogger.js";

/**
 * Options for creating a Docker sandbox container.
 */
export interface SandboxOptions {
  /** Docker image to use (default: 'node:22-alpine') */
  image: string;
  /** Memory limit in MB (default: 512) */
  memoryMB: number;
  /** CPU quota: percentage of one core (default: 50) */
  cpuQuota: number;
  /** Execution timeout in ms (default: 30000) */
  timeoutMs: number;
  /** Whether to allow network access (default: false) */
  allowNetwork: boolean;
  /** Working directory mount path on host */
  workdir: string;
  /** Environment variables for the container */
  env: Record<string, string>;
}

/**
 * Result of running a command in the sandbox.
 */
export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

/**
 * DockerSandbox – executes commands inside ephemeral Docker containers
 * with strict resource and security constraints.
 */
export class DockerSandbox {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private docker: any;
  private options: SandboxOptions;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(docker: any, options: Partial<SandboxOptions> & { workdir: string }) {
    this.docker = docker;
    this.options = {
      image: options.image ?? "node:22-alpine",
      memoryMB: options.memoryMB ?? 512,
      cpuQuota: options.cpuQuota ?? 50000,
      timeoutMs: options.timeoutMs ?? 30_000,
      allowNetwork: options.allowNetwork ?? false,
      workdir: options.workdir,
      env: options.env ?? {},
    };
  }

  /**
   * Run a command array in the sandbox container.
   */
  async run(command: string[]): Promise<SandboxResult> {
    const start = Date.now();

    await this.pullImageIfMissing(this.options.image);

    const containerConfig = this.createContainerConfig(command);
    const container = await this.docker.createContainer(containerConfig);

    try {
      await container.start();

      // Set up timeout kill
      let timedOut = false;
      const timeoutHandle = setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill();
        } catch { /* container may have already stopped */ }
      }, this.options.timeoutMs);

      // Wait for container to finish
      const waitResult = await container.wait();
      clearTimeout(timeoutHandle);

      // Collect logs
      const logs = await container.logs({ stdout: true, stderr: true });
      const logStr = logs.toString("utf-8");

      // Docker multiplexed stream: split stdout/stderr by header
      const { stdout, stderr } = this.demuxDockerLogs(logStr);

      return {
        stdout,
        stderr,
        exitCode: timedOut ? 137 : (waitResult.StatusCode ?? 1),
        durationMs: Date.now() - start,
        timedOut,
      };
    } finally {
      // Always clean up the container
      try {
        await container.remove({ force: true });
      } catch { /* ignore removal errors */ }
    }
  }

  /**
   * Run a script in a specific language inside the sandbox.
   */
  async runScript(code: string, language: "node" | "python" | "bash"): Promise<SandboxResult> {
    let command: string[];

    switch (language) {
      case "node":
        command = ["node", "-e", code];
        break;
      case "python":
        command = ["python3", "-c", code];
        break;
      case "bash":
        command = ["bash", "-c", code];
        break;
    }

    return this.run(command);
  }

  /**
   * Pull the Docker image if it's not available locally.
   */
  private async pullImageIfMissing(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      // Image not found, pull it
      const stream = await this.docker.pull(image);
      // Wait for pull to complete
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  /**
   * Create Docker container configuration with security hardening.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createContainerConfig(command: string[]): any {
    const env = Object.entries(this.options.env).map(([k, v]) => `${k}=${v}`);

    return {
      Image: this.options.image,
      Cmd: command,
      Env: env,
      WorkingDir: "/workspace",
      HostConfig: {
        // Memory limit (hard)
        Memory: this.options.memoryMB * 1024 * 1024,
        MemorySwap: this.options.memoryMB * 1024 * 1024, // No swap
        // CPU limit
        CpuQuota: this.options.cpuQuota,
        CpuPeriod: 100_000,
        // Network isolation
        NetworkMode: this.options.allowNetwork ? "bridge" : "none",
        // Read-only root filesystem
        ReadonlyRootfs: true,
        // Security: no privilege escalation
        SecurityOpt: ["no-new-privileges"],
        // Drop all capabilities
        CapDrop: ["ALL"],
        // Tmpfs for /tmp (max 64MB)
        Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
        // Mount workspace directory
        Binds: [`${this.options.workdir}:/workspace:rw`],
        // Auto-remove on cleanup
        AutoRemove: false,
      },
      // Attach stdout/stderr for log collection
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    };
  }

  /**
   * Demultiplex Docker log stream (stdout + stderr are interleaved with headers).
   */
  private demuxDockerLogs(raw: string): { stdout: string; stderr: string } {
    // Simple approach: for non-TTY containers Docker prepends an 8-byte header per chunk.
    // Since we set Tty: false, we get multiplexed output.
    // For simplicity, return everything as stdout (the header parsing is binary-safe,
    // but our logs come as string already).
    return { stdout: raw, stderr: "" };
  }

  /**
   * Check if Docker is available on the system.
   */
  static async isDockerAvailable(): Promise<boolean> {
    try {
      const { default: Dockerode } = await import("dockerode");
      const docker = new Dockerode();
      await docker.ping();
      return true;
    } catch {
      return false;
    }
  }
}
