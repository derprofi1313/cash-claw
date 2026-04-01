// Cash-Claw Debug Console
// Second terminal window that shows live debug events during onboarding

import { EventEmitter } from "node:events";
import type { ConfigEvent } from "../config/ConfigBridge.js";

const CATEGORY_COLORS: Record<string, string> = {
  CONFIG:    "\x1b[36m",   // Cyan
  VALIDATE:  "\x1b[33m",   // Yellow
  API:       "\x1b[35m",   // Magenta
  BACKEND:   "\x1b[34m",   // Blue
  ERROR:     "\x1b[31m",   // Red
  OK:        "\x1b[32m",   // Green
  // Gateway categories
  GATEWAY:   "\x1b[94m",   // Bright Blue
  THINK:     "\x1b[93m",   // Bright Yellow
  PLAN:      "\x1b[96m",   // Bright Cyan
  EXEC:      "\x1b[92m",   // Bright Green
  TELEGRAM:  "\x1b[95m",   // Bright Magenta
  LLM:       "\x1b[35m",   // Magenta
  STRIPE:    "\x1b[34m",   // Blue
};
const RESET = "\x1b[0m";

export class DebugConsole {
  private enabled: boolean;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  /** Attach to a ConfigBridge EventEmitter */
  attach(emitter: EventEmitter): void {
    if (!this.enabled) return;
    emitter.on("debug", (event: ConfigEvent) => {
      this.log(event);
    });
  }

  /** Log a debug event to stdout in formatted form */
  log(event: ConfigEvent): void {
    if (!this.enabled) return;
    const time = this.formatTime(event.timestamp);
    const color = CATEGORY_COLORS[event.category] ?? "";
    const tag = `[${event.category}]`.padEnd(12);
    console.log(`${RESET}[${time}] ${color}${tag}${RESET} ${event.message}`);
  }

  /** Print the debug console header */
  printHeader(): void {
    if (!this.enabled) return;
    console.log("");
    console.log(`${CATEGORY_COLORS.OK}╔════════════════════════════════════════════╗${RESET}`);
    console.log(`${CATEGORY_COLORS.OK}║   Cash-Claw Debug Console                  ║${RESET}`);
    console.log(`${CATEGORY_COLORS.OK}║   Live view of config & validation events   ║${RESET}`);
    console.log(`${CATEGORY_COLORS.OK}╚════════════════════════════════════════════╝${RESET}`);
    console.log("");
    this.log({ category: "OK", message: "Debug console attached – waiting for events...", timestamp: new Date() });
  }

  /** Format a Date into HH:MM:SS */
  private formatTime(date: Date): string {
    return date.toTimeString().slice(0, 8);
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

/** Standalone debug console mode – listens on stdin for JSON events */
export function runStandaloneDebugConsole(): void {
  const debug = new DebugConsole(true);
  debug.printHeader();

  process.stdin.setEncoding("utf-8");
  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const event = JSON.parse(line) as ConfigEvent;
          event.timestamp = new Date(event.timestamp);
          debug.log(event);
        } catch {
          // not JSON, print raw
          console.log(line);
        }
      }
    }
  });

  process.stdin.on("end", () => {
    debug.log({ category: "OK", message: "Debug session ended.", timestamp: new Date() });
  });
}
