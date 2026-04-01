// BrowserAdapter – Wrapper around agent-browser CLI for web automation
// Uses child_process to call the agent-browser CLI

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GatewayLogger } from "./GatewayLogger.js";

const execFileAsync = promisify(execFile);

export interface BrowserSnapshot {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: { snapshot: string; refs: Record<string, any> };
  error?: string;
}

export interface BrowserResult {
  success: boolean;
  output: string;
  error?: string;
}

export class BrowserAdapter {
  private installed: boolean | null = null;
  private sessionCount = 0;
  private maxDailySessions = 10;

  constructor(private log: GatewayLogger) {}

  /** Check if agent-browser is installed */
  async isInstalled(): Promise<boolean> {
    if (this.installed !== null) return this.installed;
    try {
      await execFileAsync("agent-browser", ["--version"], { timeout: 5000 });
      this.installed = true;
      this.log.ok("agent-browser CLI gefunden");
      return true;
    } catch {
      this.installed = false;
      this.log.gateway("agent-browser nicht installiert (npm i -g agent-browser)");
      return false;
    }
  }

  /** Open a URL in the browser */
  async open(url: string, session?: string): Promise<BrowserResult> {
    return this.run(["open", url], session);
  }

  /** Take a snapshot of interactive elements */
  async snapshot(session?: string, selector?: string): Promise<BrowserSnapshot> {
    const args = ["snapshot", "-i", "--json"];
    if (selector) args.push("-s", selector);

    const result = await this.run(args, session);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    try {
      const parsed = JSON.parse(result.output);
      return { success: true, data: parsed.data ?? parsed };
    } catch {
      return { success: false, error: "JSON parse error" };
    }
  }

  /** Click an element by ref */
  async click(ref: string, session?: string): Promise<BrowserResult> {
    return this.run(["click", ref], session);
  }

  /** Fill a field by ref */
  async fill(ref: string, text: string, session?: string): Promise<BrowserResult> {
    return this.run(["fill", ref, text], session);
  }

  /** Get text from an element */
  async getText(ref: string, session?: string): Promise<BrowserResult> {
    return this.run(["get", "text", ref, "--json"], session);
  }

  /** Get attribute from an element */
  async getAttr(ref: string, attr: string, session?: string): Promise<BrowserResult> {
    return this.run(["get", "attr", ref, attr, "--json"], session);
  }

  /** Get the current URL */
  async getUrl(session?: string): Promise<BrowserResult> {
    return this.run(["get", "url", "--json"], session);
  }

  /** Take a screenshot */
  async screenshot(outputPath: string, full = false, session?: string): Promise<BrowserResult> {
    const args = ["screenshot", outputPath];
    if (full) args.push("--full");
    return this.run(args, session);
  }

  /** Wait for an element or condition */
  async wait(target: string, session?: string): Promise<BrowserResult> {
    return this.run(["wait", target], session);
  }

  /** Wait for network idle */
  async waitForLoad(session?: string): Promise<BrowserResult> {
    return this.run(["wait", "--load", "networkidle"], session);
  }

  /** Press a key */
  async press(key: string, session?: string): Promise<BrowserResult> {
    return this.run(["press", key], session);
  }

  /** Close the browser */
  async close(session?: string): Promise<BrowserResult> {
    return this.run(["close"], session);
  }

  /** Reset daily session counter */
  resetDailyCounter(): void {
    this.sessionCount = 0;
  }

  /** Run an agent-browser command */
  private async run(args: string[], session?: string): Promise<BrowserResult> {
    if (!(await this.isInstalled())) {
      return { success: false, output: "", error: "agent-browser nicht installiert" };
    }

    if (this.sessionCount >= this.maxDailySessions) {
      return { success: false, output: "", error: `Tägliches Browser-Limit erreicht (${this.maxDailySessions})` };
    }

    const fullArgs = session ? ["--session", session, ...args] : args;
    const cmdStr = `agent-browser ${fullArgs.join(" ")}`;
    this.log.exec(`🌐 ${cmdStr}`);

    // Track sessions on 'open' commands
    if (args[0] === "open") {
      this.sessionCount++;
    }

    try {
      const { stdout, stderr } = await execFileAsync("agent-browser", fullArgs, {
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024,
      });

      if (stderr && !stdout) {
        return { success: false, output: "", error: stderr.trim() };
      }

      return { success: true, output: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`Browser-Fehler: ${msg}`);
      return { success: false, output: "", error: msg };
    }
  }
}
