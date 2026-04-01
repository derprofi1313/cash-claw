// SubAgentManager – Spawn parallel LLM sessions for subtasks
// Each sub-agent is an independent LLM call with its own system prompt

import type { LLMAdapter } from "./LLMAdapter.js";
import type { GatewayLogger } from "./GatewayLogger.js";
import type { LLMResponse } from "./types.js";

export interface SubAgentTask {
  id: string;
  name: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface SubAgentResult {
  id: string;
  name: string;
  success: boolean;
  response: string;
  costUsd: number;
  durationMs: number;
  error?: string;
}

export class SubAgentManager {
  private activeCount = 0;
  private maxConcurrent = 3;
  private totalSpawned = 0;

  constructor(
    private llm: LLMAdapter,
    private log: GatewayLogger,
  ) {}

  /** Spawn a single sub-agent */
  async spawn(task: SubAgentTask): Promise<SubAgentResult> {
    if (this.activeCount >= this.maxConcurrent) {
      return {
        id: task.id,
        name: task.name,
        success: false,
        response: "",
        costUsd: 0,
        durationMs: 0,
        error: `Max gleichzeitige Sub-Agents erreicht (${this.maxConcurrent})`,
      };
    }

    this.activeCount++;
    this.totalSpawned++;
    const start = Date.now();

    this.log.exec(`🤖 Sub-Agent "${task.name}" gestartet (#${this.totalSpawned})`);

    try {
      const response: LLMResponse = await this.llm.send(
        [{ role: "user", content: task.userPrompt }],
        task.systemPrompt,
      );

      const durationMs = Date.now() - start;
      this.log.exec(
        `✅ Sub-Agent "${task.name}" fertig (${durationMs}ms, $${response.costUsd.toFixed(4)})`,
      );

      return {
        id: task.id,
        name: task.name,
        success: true,
        response: response.text,
        costUsd: response.costUsd,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`❌ Sub-Agent "${task.name}" fehlgeschlagen: ${errMsg}`);

      return {
        id: task.id,
        name: task.name,
        success: false,
        response: "",
        costUsd: 0,
        durationMs,
        error: errMsg,
      };
    } finally {
      this.activeCount--;
    }
  }

  /** Spawn multiple sub-agents in parallel */
  async spawnParallel(tasks: SubAgentTask[]): Promise<SubAgentResult[]> {
    // Respect concurrency limit
    const batches: SubAgentTask[][] = [];
    for (let i = 0; i < tasks.length; i += this.maxConcurrent) {
      batches.push(tasks.slice(i, i + this.maxConcurrent));
    }

    const allResults: SubAgentResult[] = [];

    for (const batch of batches) {
      const results = await Promise.all(batch.map(t => this.spawn(t)));
      allResults.push(...results);
    }

    return allResults;
  }

  /** Get current stats */
  getStats(): { active: number; totalSpawned: number; maxConcurrent: number } {
    return {
      active: this.activeCount,
      totalSpawned: this.totalSpawned,
      maxConcurrent: this.maxConcurrent,
    };
  }
}
