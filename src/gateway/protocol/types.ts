// Gateway Protocol v1 — Structured WebSocket communication
// Inspired by OpenClaw's versioned req/res/event protocol with schema validation

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
//  PROTOCOL VERSION
// ═══════════════════════════════════════════════════════════════

export const PROTOCOL_VERSION = 1;

// ═══════════════════════════════════════════════════════════════
//  FRAME TYPES
// ═══════════════════════════════════════════════════════════════

/** Client → Gateway: First frame after WS connect (mandatory handshake) */
export const ConnectMessageSchema = z.object({
  type: z.literal("connect"),
  version: z.number().int().min(1).optional(),
  token: z.string().optional(),
  clientId: z.string().optional(),
});
export type ConnectMessage = z.infer<typeof ConnectMessageSchema>;

/** Gateway → Client: Handshake response */
export const ConnectResultSchema = z.object({
  type: z.literal("connected"),
  version: z.number(),
  agentName: z.string(),
  uptime: z.number(),
  toolCount: z.number(),
});
export type ConnectResult = z.infer<typeof ConnectResultSchema>;

/** Client → Gateway: RPC request */
export const RequestMessageSchema = z.object({
  type: z.literal("req"),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().optional(),
});
export type RequestMessage = z.infer<typeof RequestMessageSchema>;

/** Gateway → Client: RPC response */
export const ResponseMessageSchema = z.object({
  type: z.literal("res"),
  id: z.string(),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: z.string().optional(),
  code: z.number().optional(),
});
export type ResponseMessage = z.output<typeof ResponseMessageSchema>;

/** Gateway → Client: Server-push event */
export const EventMessageSchema = z.object({
  type: z.literal("event"),
  event: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  ts: z.number(),
});
export type EventMessage = z.output<typeof EventMessageSchema>;

/** Discriminated union for all incoming frames */
export const IncomingFrameSchema = z.discriminatedUnion("type", [
  ConnectMessageSchema,
  RequestMessageSchema,
]);
export type IncomingFrame = z.infer<typeof IncomingFrameSchema>;

// ═══════════════════════════════════════════════════════════════
//  RPC METHODS
// ═══════════════════════════════════════════════════════════════

/** All available RPC methods */
export type RpcMethod =
  | "state.get"
  | "costs.get"
  | "tools.list"
  | "skills.list"
  | "session.get"
  | "control.action"
  | "agent.plan"
  | "agent.chat";

/** Params schemas for each method */
export const RpcParamsSchemas: Record<RpcMethod, z.ZodTypeAny> = {
  "state.get": z.object({}),
  "costs.get": z.object({}),
  "tools.list": z.object({
    category: z.string().optional(),
  }),
  "skills.list": z.object({}),
  "session.get": z.object({
    limit: z.number().int().min(1).max(200).optional(),
  }),
  "control.action": z.object({
    action: z.enum(["pause", "resume", "cycle", "stop", "reflect"]),
  }),
  "agent.plan": z.object({}),
  "agent.chat": z.object({
    message: z.string().min(1).max(10000),
  }),
};

// ═══════════════════════════════════════════════════════════════
//  EVENT TYPES
// ═══════════════════════════════════════════════════════════════

/** Known event names for type safety */
export type GatewayEvent =
  | "cycle_start"
  | "cycle_end"
  | "task_start"
  | "task_complete"
  | "task_error"
  | "planning"
  | "tool_call"
  | "tool_result"
  | "cost_update"
  | "agent_state"
  | "learning"
  | "error";

// ═══════════════════════════════════════════════════════════════
//  ERROR CODES
// ═══════════════════════════════════════════════════════════════

export const ErrorCodes = {
  /** Client must send connect frame first */
  HANDSHAKE_REQUIRED: 4001,
  /** Invalid or missing auth token */
  AUTH_FAILED: 4003,
  /** Protocol version mismatch */
  VERSION_MISMATCH: 4010,
  /** Invalid JSON or schema validation failed */
  INVALID_FRAME: 4400,
  /** Unknown RPC method */
  METHOD_NOT_FOUND: 4404,
  /** Idempotency key collision (request already processed) */
  IDEMPOTENCY_CONFLICT: 4409,
  /** Internal server error */
  INTERNAL_ERROR: 4500,
  /** Service unavailable (e.g., reflection not ready) */
  SERVICE_UNAVAILABLE: 4503,
} as const;

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

/** Build a success response */
export function okResponse(id: string, payload: unknown): ResponseMessage {
  return { type: "res", id, ok: true, payload };
}

/** Build an error response */
export function errResponse(id: string, error: string, code?: number): ResponseMessage {
  return { type: "res", id, ok: false, error, code };
}

/** Build an event frame */
export function buildEvent(event: GatewayEvent, payload?: Record<string, unknown>): EventMessage {
  return { type: "event", event, payload, ts: Date.now() };
}
