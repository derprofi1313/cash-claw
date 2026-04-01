// Cron Tools – cron.schedule, cron.list, cron.cancel
// Internal scheduling system for recurring tasks

import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { Tool, ToolResult } from "../Tool.js";
import type { GatewayLogger } from "../../gateway/GatewayLogger.js";

export interface CronJob {
  id: string;
  intervalMinutes: number;
  description: string;
  interval: ReturnType<typeof setInterval>;
  createdAt: Date;
  lastRun?: Date;
  runCount: number;
}

/** Manages cron jobs and provides tools for the agent */
export class CronManager {
  private jobs = new Map<string, CronJob>();

  constructor(private log: GatewayLogger) {}

  getJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  hasJob(id: string): boolean {
    return this.jobs.has(id);
  }

  stopAll(): void {
    for (const [id, job] of this.jobs) {
      clearInterval(job.interval);
      this.log.ok(`Cron '${id}' gestoppt`);
    }
    this.jobs.clear();
  }

  /** Create tools bound to this manager */
  createTools(): Tool[] {
    return [
      buildTool({
        name: "cron.schedule",
        description: "Wiederkehrende Aufgabe planen",
        category: "scheduling",
        parameterDescription: "{ id, intervalMinutes, description }",
        concurrencySafe: false,

        inputSchema: z.object({
          id: z.string().min(1).describe("Eindeutige Job-ID"),
          intervalMinutes: z.number().min(5).describe("Intervall in Minuten (min: 5)"),
          description: z.string().describe("Was soll der Job tun?"),
        }),

        validateInput: (input) => {
          if (this.jobs.has(input.id)) {
            return { valid: false, error: `Job '${input.id}' existiert bereits` };
          }
          if (this.jobs.size >= 20) {
            return { valid: false, error: "Max 20 Cron-Jobs erlaubt" };
          }
          return { valid: true };
        },

        call: async (input): Promise<ToolResult> => {
          const start = Date.now();
          const job: CronJob = {
            id: input.id,
            intervalMinutes: input.intervalMinutes,
            description: input.description,
            createdAt: new Date(),
            runCount: 0,
            interval: setInterval(() => {
              job.lastRun = new Date();
              job.runCount++;
              this.log.exec(`⏰ Cron '${input.id}': ${input.description}`);
            }, input.intervalMinutes * 60_000),
          };
          this.jobs.set(input.id, job);
          this.log.ok(`Cron '${input.id}' geplant: alle ${input.intervalMinutes} Min`);
          return {
            data: { id: input.id, intervalMinutes: input.intervalMinutes, description: input.description },
            meta: { durationMs: Date.now() - start },
          };
        },
      }),

      buildTool({
        name: "cron.list",
        description: "Geplante Aufgaben anzeigen",
        category: "scheduling",
        parameterDescription: "{}",
        readOnly: true,
        inputSchema: z.object({}),

        call: async (): Promise<ToolResult> => {
          const start = Date.now();
          const jobs = this.getJobs().map(j => ({
            id: j.id,
            intervalMinutes: j.intervalMinutes,
            description: j.description,
            createdAt: j.createdAt.toISOString(),
            lastRun: j.lastRun?.toISOString() ?? null,
            runCount: j.runCount,
          }));
          return { data: jobs, meta: { durationMs: Date.now() - start } };
        },
      }),

      buildTool({
        name: "cron.cancel",
        description: "Geplante Aufgabe abbrechen",
        category: "scheduling",
        parameterDescription: "{ id }",
        concurrencySafe: false,
        inputSchema: z.object({
          id: z.string().describe("Job-ID"),
        }),

        validateInput: (input) => {
          if (!this.jobs.has(input.id)) {
            return { valid: false, error: `Job '${input.id}' nicht gefunden` };
          }
          return { valid: true };
        },

        call: async (input): Promise<ToolResult> => {
          const start = Date.now();
          const job = this.jobs.get(input.id)!;
          clearInterval(job.interval);
          this.jobs.delete(input.id);
          this.log.ok(`Cron '${input.id}' abgebrochen`);
          return { data: { id: input.id, cancelled: true }, meta: { durationMs: Date.now() - start } };
        },
      }),
    ];
  }
}
