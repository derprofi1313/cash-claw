// Tool.ts – Core Tool abstraction inspired by Claude Code's tool system
// Each tool is a self-contained unit with schema, validation, permissions, and execution

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
//  CORE TYPES
// ═══════════════════════════════════════════════════════════════

/** Result of a tool execution */
export interface ToolResult<T = unknown> {
  data: T;
  /** Optional messages to inject into the conversation */
  newMessages?: ToolMessage[];
  /** Metadata for cost/usage tracking */
  meta?: {
    durationMs: number;
    tokensUsed?: number;
    costUsd?: number;
  };
}

/** Message that can be injected by tool results */
export interface ToolMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Permission decision for a tool call */
export type PermissionResult =
  | { behavior: "allow" }
  | { behavior: "deny"; reason: string }
  | { behavior: "confirm"; message: string };

/** Validation result for tool input */
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string; code?: number };

/** Tool execution context – carries state through the system */
export interface ToolContext {
  /** Current working directory (usually ~/.cashclaw) */
  workspaceDir: string;
  /** Permission mode for the current session */
  permissionMode: PermissionMode;
  /** Get current agent state */
  getState: () => AgentStateSnapshot;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Progress callback for streaming updates */
  onProgress?: (update: ToolProgress) => void;
}

/** Snapshot of current agent state (read-only) */
export interface AgentStateSnapshot {
  running: boolean;
  paused: boolean;
  actionsToday: number;
  costToday: number;
  dailyBudgetUsd: number;
  cycleCount: number;
  operatorEmailApproval?: boolean;
}

/** Progress update from a tool */
export interface ToolProgress {
  type: "status" | "partial" | "error";
  message: string;
  /** 0-1 progress indicator (optional) */
  progress?: number;
}

/** Permission modes */
export type PermissionMode =
  | "default"     // Ask for destructive operations
  | "autonomous"  // Auto-approve most operations (normal AEL mode)
  | "read_only"   // Deny all write operations
  | "manual";     // Ask for everything

/** Tool category for grouping in system prompt */
export type ToolCategory =
  | "filesystem"
  | "communication"
  | "google_workspace"
  | "browser"
  | "learning"
  | "skills"
  | "agents"
  | "scheduling"
  | "payments"
  | "llm";

// ═══════════════════════════════════════════════════════════════
//  TOOL INTERFACE
// ═══════════════════════════════════════════════════════════════

/**
 * Core Tool interface – every tool must implement this.
 * Modeled after Claude Code's Tool<Input, Output> pattern.
 *
 * @template TInput  Zod-validated input type
 * @template TOutput Output data type
 */
export interface Tool<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = unknown,
> {
  /** Unique tool name in namespace.method format (e.g., "fs.read") */
  readonly name: string;

  /** Human-readable description for LLM system prompt */
  readonly description: string;

  /** Category for grouping */
  readonly category: ToolCategory;

  /** Zod schema for input validation */
  readonly inputSchema: TInput;

  /** Parameter description for the LLM (shown in system prompt) */
  readonly parameterDescription: string;

  /** Can this tool run in parallel with other tools? */
  isConcurrencySafe(): boolean;

  /** Is this tool read-only (no side effects)? */
  isReadOnly(): boolean;

  /** Is this tool potentially destructive? */
  isDestructive(): boolean;

  /** Is this tool currently available (based on config/state)? */
  isEnabled(): boolean;

  /** Validate input beyond schema (e.g., file exists, path is safe) */
  validateInput(input: z.output<TInput>, ctx: ToolContext): ValidationResult | Promise<ValidationResult>;

  /** Check permissions for this specific input */
  checkPermissions(input: z.output<TInput>, ctx: ToolContext): PermissionResult | Promise<PermissionResult>;

  /** Execute the tool */
  call(input: z.output<TInput>, ctx: ToolContext): Promise<ToolResult<TOutput>>;
}

// ═══════════════════════════════════════════════════════════════
//  TOOL BUILDER
// ═══════════════════════════════════════════════════════════════

/** Options for buildTool() – simplified tool definition */
export interface ToolDefinition<
  TInput extends z.ZodTypeAny,
  TOutput,
> {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: TInput;
  parameterDescription: string;

  /** Defaults to true */
  concurrencySafe?: boolean;
  /** Defaults to false */
  readOnly?: boolean;
  /** Defaults to false */
  destructive?: boolean;
  /** Defaults to () => true */
  isEnabled?: () => boolean;

  validateInput?: (input: z.output<TInput>, ctx: ToolContext) => ValidationResult | Promise<ValidationResult>;
  checkPermissions?: (input: z.output<TInput>, ctx: ToolContext) => PermissionResult | Promise<PermissionResult>;
  call: (input: z.output<TInput>, ctx: ToolContext) => Promise<ToolResult<TOutput>>;
}

/**
 * Build a Tool from a simplified definition.
 * Provides sensible defaults for optional methods.
 */
export function buildTool<
  TInput extends z.ZodTypeAny,
  TOutput,
>(def: ToolDefinition<TInput, TOutput>): Tool<TInput, TOutput> {
  return {
    name: def.name,
    description: def.description,
    category: def.category,
    inputSchema: def.inputSchema,
    parameterDescription: def.parameterDescription,

    isConcurrencySafe: () => def.concurrencySafe ?? true,
    isReadOnly: () => def.readOnly ?? false,
    isDestructive: () => def.destructive ?? false,
    isEnabled: def.isEnabled ?? (() => true),

    validateInput: def.validateInput ?? (() => ({ valid: true })),

    checkPermissions: def.checkPermissions ?? ((_, ctx) => {
      // Default: allow read-only in all modes, check write ops
      if (def.readOnly) return { behavior: "allow" as const };
      if (ctx.permissionMode === "autonomous") return { behavior: "allow" as const };
      if (ctx.permissionMode === "read_only") return { behavior: "deny" as const, reason: "Schreiboperationen deaktiviert" };
      if (ctx.permissionMode === "manual") return { behavior: "confirm" as const, message: `Tool '${def.name}' ausführen?` };
      // default mode: allow non-destructive, confirm destructive
      if (def.destructive) return { behavior: "confirm" as const, message: `Destruktive Operation: ${def.name}` };
      return { behavior: "allow" as const };
    }),

    call: def.call,
  };
}

// ═══════════════════════════════════════════════════════════════
//  TOOL EXECUTION FORMAT (LLM ↔ ToolExecutor)
// ═══════════════════════════════════════════════════════════════

/** A tool call as parsed from LLM output */
export interface ToolCall {
  /** Unique ID for this tool invocation */
  id: string;
  /** Tool name (e.g., "fs.read") */
  tool: string;
  /** Parameters from the LLM */
  params: Record<string, unknown>;
}

/** Result of a tool call, ready for message chain */
export interface ToolCallResult {
  /** Matches the ToolCall.id */
  toolCallId: string;
  /** Tool name */
  tool: string;
  /** Whether the call succeeded */
  success: boolean;
  /** Output data (serialized for LLM) */
  output: string;
  /** Error message if failed */
  error?: string;
  /** Execution metadata */
  meta: {
    durationMs: number;
    tokensUsed?: number;
    costUsd?: number;
  };
}

/** Message types for the structured conversation */
export type ConversationMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool_result"; toolCallId: string; tool: string; content: string; isError?: boolean };
