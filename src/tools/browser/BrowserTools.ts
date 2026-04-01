// Browser Tools – browser.open, browser.snapshot, browser.click, browser.fill, browser.getText, browser.close
// Web automation via agent-browser CLI

import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { Tool } from "../Tool.js";
import type { BrowserAdapter } from "../../gateway/BrowserAdapter.js";

/** Factory: creates browser tools bound to a BrowserAdapter instance */
export function createBrowserTools(browser: BrowserAdapter | null): Tool[] {
  const isAvailable = () => browser !== null;

  // Helper: wrap browser adapter calls
  async function browserCall<T>(fn: () => Promise<{ success: boolean; output?: string; data?: T; error?: string }>): Promise<{ data: T; meta: { durationMs: number } }> {
    const start = Date.now();
    const result = await fn();
    if (!result.success) throw new Error(result.error ?? "Browser Fehler");
    return { data: (result.data ?? result.output) as T, meta: { durationMs: Date.now() - start } };
  }

  return [
    buildTool({
      name: "browser.open",
      description: "Website öffnen",
      category: "browser",
      parameterDescription: "{ url, session? }",
      concurrencySafe: false,
      isEnabled: isAvailable,
      inputSchema: z.object({
        url: z.string().url().describe("URL der Website"),
        session: z.string().optional().describe("Session-ID"),
      }),
      async call(input) {
        return browserCall(() => browser!.open(input.url, input.session));
      },
    }),

    buildTool({
      name: "browser.snapshot",
      description: "Seiteninhalt erfassen (Accessibility Tree)",
      category: "browser",
      parameterDescription: "{ session?, selector? }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        session: z.string().optional().describe("Session-ID"),
        selector: z.string().optional().describe("CSS-Selector für Teilbereich"),
      }),
      async call(input) {
        return browserCall(() => browser!.snapshot(input.session, input.selector));
      },
    }),

    buildTool({
      name: "browser.click",
      description: "Element klicken",
      category: "browser",
      parameterDescription: "{ ref, session? }",
      concurrencySafe: false,
      isEnabled: isAvailable,
      inputSchema: z.object({
        ref: z.string().describe("Element-Referenz aus dem Accessibility Tree"),
        session: z.string().optional().describe("Session-ID"),
      }),
      async call(input) {
        return browserCall(() => browser!.click(input.ref, input.session));
      },
    }),

    buildTool({
      name: "browser.fill",
      description: "Formularfeld ausfüllen",
      category: "browser",
      parameterDescription: "{ ref, text, session? }",
      concurrencySafe: false,
      isEnabled: isAvailable,
      inputSchema: z.object({
        ref: z.string().describe("Element-Referenz"),
        text: z.string().describe("Einzugebender Text"),
        session: z.string().optional().describe("Session-ID"),
      }),
      async call(input) {
        return browserCall(() => browser!.fill(input.ref, input.text, input.session));
      },
    }),

    buildTool({
      name: "browser.getText",
      description: "Text eines Elements extrahieren",
      category: "browser",
      parameterDescription: "{ ref, session? }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        ref: z.string().describe("Element-Referenz"),
        session: z.string().optional().describe("Session-ID"),
      }),
      async call(input) {
        return browserCall(() => browser!.getText(input.ref, input.session));
      },
    }),

    buildTool({
      name: "browser.close",
      description: "Browser-Session schließen",
      category: "browser",
      parameterDescription: "{ session? }",
      concurrencySafe: false,
      isEnabled: isAvailable,
      inputSchema: z.object({
        session: z.string().optional().describe("Session-ID"),
      }),
      async call(input) {
        return browserCall(() => browser!.close(input.session));
      },
    }),
  ];
}
