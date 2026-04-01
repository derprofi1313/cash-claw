// GogAdapter – Wrapper around gog CLI for Google Workspace access
// Gmail, Calendar, Drive, Contacts, Sheets, Docs via local OAuth
// CLI: https://github.com/steipete/gogcli | Skill: https://clawhub.ai/steipete/gog

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GatewayLogger } from "./GatewayLogger.js";

const execFileAsync = promisify(execFile);

export interface GogConfig {
  account: string; // Gmail account e.g. user@gmail.com
  enabled: boolean;
  credentialsPath?: string; // path to client_secret.json
}

export interface GogResult {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  raw: string;
  error?: string;
}

export class GogAdapter {
  private installed: boolean | null = null;

  constructor(
    private config: GogConfig,
    private log: GatewayLogger,
  ) {}

  get enabled(): boolean {
    return this.config.enabled && !!this.config.account;
  }

  /** Check if gog CLI is installed and authenticated */
  async testConnection(): Promise<boolean> {
    if (!this.enabled) {
      this.log.gateway("gog nicht konfiguriert – übersprungen");
      return false;
    }
    try {
      const installed = await this.isInstalled();
      if (!installed) return false;

      // Check if account is authenticated
      const result = await this.run(["auth", "list", "--json"]);
      if (result.success) {
        this.log.ok(`gog CLI verbunden: ${this.config.account}`);
        return true;
      }
      this.log.error(`gog auth nicht konfiguriert: ${result.error}`);
      return false;
    } catch (err) {
      this.log.error(
        `gog Verbindung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /** Check if gog binary is available */
  async isInstalled(): Promise<boolean> {
    if (this.installed !== null) return this.installed;
    try {
      await execFileAsync("gog", ["--version"], { timeout: 5000 });
      this.installed = true;
      this.log.ok("gog CLI gefunden");
      return true;
    } catch {
      this.installed = false;
      this.log.gateway("gog nicht installiert – siehe https://github.com/steipete/gogcli");
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  GMAIL
  // ═══════════════════════════════════════════════════════════════

  /** Send an email via Gmail */
  async gmailSend(to: string, subject: string, body: string): Promise<GogResult> {
    return this.run([
      "gmail", "send",
      "--to", to,
      "--subject", subject,
      "--body", body,
      "--no-input",
    ]);
  }

  /** Search Gmail messages */
  async gmailSearch(query: string, maxResults = 10): Promise<GogResult> {
    return this.run([
      "gmail", "search",
      query,
      "--max", String(maxResults),
      "--json",
    ]);
  }

  /** Read a specific Gmail message */
  async gmailRead(messageId: string): Promise<GogResult> {
    return this.run(["gmail", "get", messageId, "--json"]);
  }

  /** Mark a message as read */
  async gmailMarkRead(messageId: string): Promise<GogResult> {
    return this.run([
      "gmail", "labels", "modify", messageId,
      "--remove", "UNREAD",
    ]);
  }

  // ═══════════════════════════════════════════════════════════════
  //  GOOGLE CALENDAR
  // ═══════════════════════════════════════════════════════════════

  /** List upcoming calendar events */
  async calendarList(
    calendarId = "primary",
    from?: string,
    to?: string,
  ): Promise<GogResult> {
    const args = ["calendar", "events", calendarId, "--json"];
    if (from) args.push("--from", from);
    if (to) args.push("--to", to);
    return this.run(args);
  }

  /** Create a calendar event */
  async calendarCreate(
    calendarId: string,
    summary: string,
    start: string,
    end: string,
    description?: string,
  ): Promise<GogResult> {
    const args = [
      "calendar", "events", "create", calendarId,
      "--summary", summary,
      "--start", start,
      "--end", end,
    ];
    if (description) args.push("--description", description);
    args.push("--no-input");
    return this.run(args);
  }

  // ═══════════════════════════════════════════════════════════════
  //  GOOGLE SHEETS
  // ═══════════════════════════════════════════════════════════════

  /** Read a range from a spreadsheet */
  async sheetsRead(spreadsheetId: string, range: string): Promise<GogResult> {
    return this.run([
      "sheets", "get", spreadsheetId, range, "--json",
    ]);
  }

  /** Append rows to a spreadsheet */
  async sheetsAppend(
    spreadsheetId: string,
    range: string,
    values: string[][],
  ): Promise<GogResult> {
    return this.run([
      "sheets", "append", spreadsheetId, range,
      "--values-json", JSON.stringify(values),
      "--insert", "INSERT_ROWS",
    ]);
  }

  /** Update a range in a spreadsheet */
  async sheetsUpdate(
    spreadsheetId: string,
    range: string,
    values: string[][],
  ): Promise<GogResult> {
    return this.run([
      "sheets", "update", spreadsheetId, range,
      "--values-json", JSON.stringify(values),
      "--input", "USER_ENTERED",
    ]);
  }

  /** Get spreadsheet metadata */
  async sheetsMetadata(spreadsheetId: string): Promise<GogResult> {
    return this.run(["sheets", "metadata", spreadsheetId, "--json"]);
  }

  // ═══════════════════════════════════════════════════════════════
  //  GOOGLE DRIVE
  // ═══════════════════════════════════════════════════════════════

  /** Search files in Drive */
  async driveSearch(query: string, maxResults = 10): Promise<GogResult> {
    return this.run([
      "drive", "search", query, "--max", String(maxResults), "--json",
    ]);
  }

  /** List files in Drive */
  async driveList(maxResults = 10): Promise<GogResult> {
    return this.run(["drive", "search", "", "--max", String(maxResults), "--json"]);
  }

  // ═══════════════════════════════════════════════════════════════
  //  GOOGLE CONTACTS
  // ═══════════════════════════════════════════════════════════════

  /** List contacts */
  async contactsList(maxResults = 20): Promise<GogResult> {
    return this.run(["contacts", "list", "--max", String(maxResults), "--json"]);
  }

  // ═══════════════════════════════════════════════════════════════
  //  GOOGLE DOCS
  // ═══════════════════════════════════════════════════════════════

  /** Read a Google Doc as text */
  async docsRead(docId: string): Promise<GogResult> {
    return this.run(["docs", "cat", docId]);
  }

  /** Export a Google Doc */
  async docsExport(docId: string, format: string, outPath: string): Promise<GogResult> {
    return this.run([
      "docs", "export", docId,
      "--format", format,
      "--out", outPath,
    ]);
  }

  // ═══════════════════════════════════════════════════════════════
  //  AUTH MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /** List authenticated accounts */
  async authList(): Promise<GogResult> {
    return this.run(["auth", "list", "--json"]);
  }

  /** Set up credentials file */
  async authCredentials(credentialsPath: string): Promise<GogResult> {
    return this.run(["auth", "credentials", credentialsPath]);
  }

  /** Add an account with services */
  async authAdd(
    email: string,
    services = "gmail,calendar,drive,contacts,sheets,docs",
  ): Promise<GogResult> {
    return this.run(["auth", "add", email, "--services", services]);
  }

  // ═══════════════════════════════════════════════════════════════
  //  CLI RUNNER
  // ═══════════════════════════════════════════════════════════════

  private async run(args: string[]): Promise<GogResult> {
    try {
      const env: Record<string, string> = { ...process.env as Record<string, string> };
      if (this.config.account) {
        env.GOG_ACCOUNT = this.config.account;
      }

      const { stdout, stderr } = await execFileAsync("gog", args, {
        timeout: 30_000,
        env,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      });

      const output = stdout.trim();

      // Try to parse as JSON
      let data: unknown = output;
      try {
        data = JSON.parse(output);
      } catch {
        // plain text output is fine
      }

      if (stderr && stderr.trim()) {
        this.log.gateway(`gog stderr: ${stderr.trim().substring(0, 200)}`);
      }

      return { success: true, data, raw: output };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`gog Fehler [${args[0]} ${args[1] ?? ""}]: ${errMsg.substring(0, 200)}`);
      return { success: false, data: null, raw: "", error: errMsg };
    }
  }
}
