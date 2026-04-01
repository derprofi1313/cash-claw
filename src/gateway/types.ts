// Gateway-specific types for the Autonomous Execution Loop

export interface AgentTask {
  id: number;
  type: string;
  title: string;
  details: string;
  estimatedMinutes: number;
  priority: "high" | "medium" | "low";
}

export interface AgentPlan {
  thinking: string;
  tasks: AgentTask[];
}

export interface TaskResult {
  taskId: number;
  title: string;
  success: boolean;
  thinking: string;
  result: string;
  summary: string;
  tokensUsed: { prompt: number; completion: number };
  costUsd: number;
  durationMs: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  text: string;
  tokensUsed: { prompt: number; completion: number };
  costUsd: number;
}

export interface AgentState {
  running: boolean;
  paused: boolean;
  actionsToday: number;
  costToday: number;
  currentTask: AgentTask | null;
  lastPlanTime: Date | null;
  cycleCount: number;
  tasksCompleted: TaskResult[];
  startedAt: Date | null;
}
