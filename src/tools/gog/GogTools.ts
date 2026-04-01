// Google Workspace Tools â€“ gog.gmail.*, gog.calendar.*, gog.sheets.*, etc.
// All tools use the gog CLI adapter

import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { Tool } from "../Tool.js";
import type { GogAdapter } from "../../gateway/GogAdapter.js";

/** Factory: creates all gog tools bound to a GogAdapter instance */
export function createGogTools(gog: GogAdapter | null): Tool[] {
  const isAvailable = () => gog?.enabled === true;

  // Helper: wrap gog adapter calls into ToolResult
  async function gogCall<T>(fn: () => Promise<{ success: boolean; data?: T; error?: string }>): Promise<{ data: T; meta: { durationMs: number } }> {
    const start = Date.now();
    const result = await fn();
    if (!result.success) throw new Error(result.error ?? "gog Fehler");
    return { data: result.data as T, meta: { durationMs: Date.now() - start } };
  }

  return [
    // â”€â”€â”€ Gmail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    buildTool({
      name: "gog.gmail.send",
      description: "E-Mail senden",
      category: "google_workspace",
      parameterDescription: "{ to, subject, body }",
      isEnabled: isAvailable,
      destructive: true,
      concurrencySafe: false,
      inputSchema: z.object({
        to: z.string().email().describe("Empfaenger E-Mail"),
        subject: z.string().min(1).describe("Betreff"),
        body: z.string().min(1).describe("E-Mail Text"),
      }),
      checkPermissions: (_input, ctx) => {
        if (ctx.getState().operatorEmailApproval !== true) {
          return {
            behavior: "deny",
            reason: "Operator-Freigabe fuer E-Mail fehlt. Erst Entwurf zeigen und Freigabe einholen.",
          };
        }
        return { behavior: "allow" };
      },
      async call(input) {
        return gogCall(() => gog!.gmailSend(input.to, input.subject, input.body));
      },
    }),

    buildTool({
      name: "gog.gmail.search",
      description: "E-Mails suchen",
      category: "google_workspace",
      parameterDescription: "{ query, maxResults? }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        query: z.string().describe("Gmail-Suchquery"),
        maxResults: z.number().optional().describe("Max Ergebnisse"),
      }),
      async call(input) {
        return gogCall(() => gog!.gmailSearch(input.query, input.maxResults));
      },
    }),

    buildTool({
      name: "gog.gmail.read",
      description: "E-Mail lesen",
      category: "google_workspace",
      parameterDescription: "{ messageId }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        messageId: z.string().describe("Message-ID"),
      }),
      async call(input) {
        return gogCall(() => gog!.gmailRead(input.messageId));
      },
    }),

    // â”€â”€â”€ Calendar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    buildTool({
      name: "gog.calendar.list",
      description: "Termine auflisten",
      category: "google_workspace",
      parameterDescription: "{ calendarId?, from?, to? }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        calendarId: z.string().optional().describe("Kalender-ID (default: primary)"),
        from: z.string().optional().describe("Start-Datum (ISO)"),
        to: z.string().optional().describe("End-Datum (ISO)"),
      }),
      async call(input) {
        return gogCall(() => gog!.calendarList(input.calendarId, input.from, input.to));
      },
    }),

    buildTool({
      name: "gog.calendar.create",
      description: "Termin erstellen",
      category: "google_workspace",
      parameterDescription: "{ calendarId?, summary, start, end, description? }",
      isEnabled: isAvailable,
      destructive: true,
      concurrencySafe: false,
      inputSchema: z.object({
        calendarId: z.string().optional().default("primary").describe("Kalender-ID"),
        summary: z.string().describe("Titel des Termins"),
        start: z.string().describe("Start-Zeitpunkt (ISO)"),
        end: z.string().describe("End-Zeitpunkt (ISO)"),
        description: z.string().optional().describe("Beschreibung"),
      }),
      async call(input) {
        return gogCall(() => gog!.calendarCreate(input.calendarId, input.summary, input.start, input.end, input.description));
      },
    }),

    // â”€â”€â”€ Sheets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    buildTool({
      name: "gog.sheets.read",
      description: "Google Sheets lesen",
      category: "google_workspace",
      parameterDescription: "{ spreadsheetId, range }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        spreadsheetId: z.string().describe("Spreadsheet-ID"),
        range: z.string().describe("Bereich (z.B. 'Sheet1!A1:D10')"),
      }),
      async call(input) {
        return gogCall(() => gog!.sheetsRead(input.spreadsheetId, input.range));
      },
    }),

    buildTool({
      name: "gog.sheets.append",
      description: "Zeilen an Sheets anhÃ¤ngen",
      category: "google_workspace",
      parameterDescription: "{ spreadsheetId, range, values }",
      isEnabled: isAvailable,
      concurrencySafe: false,
      inputSchema: z.object({
        spreadsheetId: z.string().describe("Spreadsheet-ID"),
        range: z.string().describe("Bereich"),
        values: z.array(z.array(z.string())).describe("Zeilen mit Zellen"),
      }),
      async call(input) {
        return gogCall(() => gog!.sheetsAppend(input.spreadsheetId, input.range, input.values));
      },
    }),

    buildTool({
      name: "gog.sheets.update",
      description: "Sheets-Zellen aktualisieren",
      category: "google_workspace",
      parameterDescription: "{ spreadsheetId, range, values }",
      isEnabled: isAvailable,
      concurrencySafe: false,
      inputSchema: z.object({
        spreadsheetId: z.string().describe("Spreadsheet-ID"),
        range: z.string().describe("Bereich"),
        values: z.array(z.array(z.string())).describe("Neue Werte"),
      }),
      async call(input) {
        return gogCall(() => gog!.sheetsUpdate(input.spreadsheetId, input.range, input.values));
      },
    }),

    // â”€â”€â”€ Drive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    buildTool({
      name: "gog.drive.search",
      description: "Drive durchsuchen",
      category: "google_workspace",
      parameterDescription: "{ query, maxResults? }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        query: z.string().describe("Suchquery"),
        maxResults: z.number().optional().describe("Max Ergebnisse"),
      }),
      async call(input) {
        return gogCall(() => gog!.driveSearch(input.query, input.maxResults));
      },
    }),

    buildTool({
      name: "gog.drive.list",
      description: "Drive-Dateien auflisten",
      category: "google_workspace",
      parameterDescription: "{ maxResults? }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        maxResults: z.number().optional().describe("Max Ergebnisse"),
      }),
      async call(input) {
        return gogCall(() => gog!.driveList(input.maxResults));
      },
    }),

    // â”€â”€â”€ Contacts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    buildTool({
      name: "gog.contacts.list",
      description: "Kontakte auflisten",
      category: "google_workspace",
      parameterDescription: "{ maxResults? }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        maxResults: z.number().optional().describe("Max Ergebnisse"),
      }),
      async call(input) {
        return gogCall(() => gog!.contactsList(input.maxResults));
      },
    }),

    // â”€â”€â”€ Docs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    buildTool({
      name: "gog.docs.read",
      description: "Google Doc lesen",
      category: "google_workspace",
      parameterDescription: "{ docId }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        docId: z.string().describe("Google Doc ID"),
      }),
      async call(input) {
        return gogCall(() => gog!.docsRead(input.docId));
      },
    }),
  ];
}

