// HttpGateway – Real HTTP + WebSocket server for Cash-Claw
// Protocol v1: Structured req/res/event WebSocket + REST API
// Binds to 127.0.0.1 (loopback only) for security

import http from "node:http";
import crypto from "node:crypto";
import type { Socket } from "node:net";
import type { GatewayLogger } from "./GatewayLogger.js";
import type { AgentRuntime } from "./AgentRuntime.js";
import type { CostTracker } from "./CostTracker.js";
import type { SessionManager } from "./SessionManager.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { MonetizationSkills } from "./MonetizationSkills.js";
import type { DailyReflection } from "./DailyReflection.js";
import type { DashboardData } from "./DashboardData.js";
import type { ToolCategory } from "../tools/Tool.js";
import {
  PROTOCOL_VERSION,
  ConnectMessageSchema,
  RequestMessageSchema,
  IncomingFrameSchema,
  RpcParamsSchemas,
  ErrorCodes,
  okResponse,
  errResponse,
  buildEvent,
  type RpcMethod,
  type ResponseMessage,
  type ConnectResult,
  type GatewayEvent,
} from "./protocol/types.js";
import { getDashboardHtml } from "./dashboard.js";

// ═══════════════════════════════════════════════════════════════
//  WEBSOCKET (minimal implementation – no external dependency)
// ═══════════════════════════════════════════════════════════════

interface WsClient {
  socket: Socket;
  alive: boolean;
  authenticated: boolean;
  clientId: string;
}

/** Short-lived idempotency cache (method+key → response) */
interface IdempotencyEntry {
  response: ResponseMessage;
  expiresAt: number;
}

function acceptWebSocket(req: http.IncomingMessage, socket: Socket): boolean {
  const key = req.headers["sec-websocket-key"];
  if (!key) return false;

  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-5AB9ADB63623")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n",
  );
  return true;
}

function sendWsFrame(socket: Socket, data: string): void {
  const buf = Buffer.from(data, "utf-8");
  const header: number[] = [0x81]; // FIN + TEXT

  if (buf.length < 126) {
    header.push(buf.length);
  } else if (buf.length < 65536) {
    header.push(126, (buf.length >> 8) & 0xff, buf.length & 0xff);
  } else {
    header.push(
      127,
      0, 0, 0, 0,
      (buf.length >> 24) & 0xff,
      (buf.length >> 16) & 0xff,
      (buf.length >> 8) & 0xff,
      buf.length & 0xff,
    );
  }

  socket.write(Buffer.concat([Buffer.from(header), buf]));
}

/** Decode a masked WebSocket text frame payload */
function decodeWsTextFrame(data: Buffer): string | null {
  if (data.length < 2) return null;

  const opcode = data[0] & 0x0f;
  if (opcode !== 0x01) return null; // not text

  const masked = (data[1] & 0x80) !== 0;
  let payloadLen = data[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (data.length < 4) return null;
    payloadLen = (data[2] << 8) | data[3];
    offset = 4;
  } else if (payloadLen === 127) {
    if (data.length < 10) return null;
    // For simplicity, only handle payloads < 2^32
    payloadLen = (data[6] << 24) | (data[7] << 16) | (data[8] << 8) | data[9];
    offset = 10;
  }

  if (masked) {
    if (data.length < offset + 4 + payloadLen) return null;
    const maskKey = data.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      payload[i] = data[offset + i] ^ maskKey[i % 4];
    }
    return payload.toString("utf-8");
  }

  if (data.length < offset + payloadLen) return null;
  return data.subarray(offset, offset + payloadLen).toString("utf-8");
}

// ═══════════════════════════════════════════════════════════════
//  HTTP GATEWAY
// ═══════════════════════════════════════════════════════════════

export class HttpGateway {
  private server: http.Server | null = null;
  private wsClients: WsClient[] = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private authToken: string | null;
  private idempotencyCache = new Map<string, IdempotencyEntry>();
  private idempotencyCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private dashboardData: DashboardData | null = null;

  constructor(
    private port: number,
    private log: GatewayLogger,
    private runtime: AgentRuntime,
    private costTracker: CostTracker,
    private session: SessionManager,
    private registry: ToolRegistry,
    private skills: MonetizationSkills | null,
    private reflection: DailyReflection | null = null,
    private stripeWebhookSecret: string | null = null,
  ) {
    this.authToken = process.env["CASHCLAW_GATEWAY_TOKEN"] ?? null;
  }

  /** Set the DashboardData aggregator for enhanced API endpoints */
  setDashboardData(data: DashboardData): void {
    this.dashboardData = data;
  }

  /** Start the HTTP + WebSocket server */
  start(): void {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    // Handle WebSocket upgrades
    this.server.on("upgrade", (req, socket, _head) => {
      const sock = socket as Socket;
      if (req.url === "/ws") {
        const accepted = acceptWebSocket(req, sock);
        if (!accepted) {
          sock.destroy();
          return;
        }

        const clientId = crypto.randomUUID().slice(0, 8);
        const client: WsClient = {
          socket: sock,
          alive: true,
          authenticated: !this.authToken, // auto-auth if no token configured
          clientId,
        };
        this.wsClients.push(client);
        this.log.gateway(`WS client ${clientId} connected (${this.wsClients.length} active)`);

        // Set handshake timeout: client must send 'connect' within 5s
        const handshakeTimeout = setTimeout(() => {
          if (!client.authenticated) {
            this.log.gateway(`WS client ${clientId} handshake timeout`);
            this.sendToClient(client, errResponse("_handshake", "Handshake timeout", ErrorCodes.HANDSHAKE_REQUIRED));
            this.removeClient(client);
          }
        }, 5000);

        // Handle incoming data
        sock.on("data", (data: Buffer) => {
          const opcode = data[0] & 0x0f;

          // Pong
          if (opcode === 0x0a) {
            client.alive = true;
            return;
          }
          // Close
          if (opcode === 0x08) {
            clearTimeout(handshakeTimeout);
            this.removeClient(client);
            return;
          }
          // Text frame
          if (opcode === 0x01) {
            const text = decodeWsTextFrame(data);
            if (text) {
              this.handleWsMessage(client, text);
            }
          }
        });

        sock.on("close", () => {
          clearTimeout(handshakeTimeout);
          this.removeClient(client);
        });
        sock.on("error", () => {
          clearTimeout(handshakeTimeout);
          this.removeClient(client);
        });
      } else {
        sock.destroy();
      }
    });

    // Bind to loopback only (zero-trust)
    this.server.listen(this.port, "127.0.0.1", () => {
      this.log.ok(`HTTP Gateway on http://127.0.0.1:${this.port}`);
      this.log.ok(`WebSocket: ws://127.0.0.1:${this.port}/ws (Protocol v${PROTOCOL_VERSION})`);
      if (this.authToken) {
        this.log.ok("Auth token enabled (CASHCLAW_GATEWAY_TOKEN)");
      }
    });

    // Ping clients every 30s
    this.pingInterval = setInterval(() => this.pingClients(), 30_000);

    // Clean expired idempotency entries every 60s
    this.idempotencyCleanupInterval = setInterval(() => this.cleanIdempotencyCache(), 60_000);
  }

  /** Stop the server */
  stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.idempotencyCleanupInterval) {
      clearInterval(this.idempotencyCleanupInterval);
      this.idempotencyCleanupInterval = null;
    }

    for (const client of this.wsClients) {
      client.socket.destroy();
    }
    this.wsClients = [];

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /** Broadcast an event to all authenticated WebSocket clients */
  broadcast(event: GatewayEvent, payload?: Record<string, unknown>): void {
    const frame = buildEvent(event, payload);
    const data = JSON.stringify(frame);
    for (const client of this.wsClients) {
      if (!client.authenticated) continue;
      try {
        sendWsFrame(client.socket, data);
      } catch {
        this.removeClient(client);
      }
    }
  }

  // ─── WebSocket Protocol v1 Handler ──────────────────────────

  private handleWsMessage(client: WsClient, text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.sendToClient(client, errResponse("_parse", "Invalid JSON", ErrorCodes.INVALID_FRAME));
      return;
    }

    // Validate frame structure
    const frameResult = IncomingFrameSchema.safeParse(parsed);
    if (!frameResult.success) {
      const errors = frameResult.error.issues.map(i => i.message).join("; ");
      this.sendToClient(client, errResponse("_validate", `Invalid frame: ${errors}`, ErrorCodes.INVALID_FRAME));
      return;
    }

    const frame = frameResult.data;

    // ─── Connect handshake ─────────────────────────────────
    if (frame.type === "connect") {
      // Version check (default to current version if not specified)
      const clientVersion = frame.version ?? PROTOCOL_VERSION;
      if (clientVersion !== PROTOCOL_VERSION) {
        this.sendToClient(client, errResponse("_connect", `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${clientVersion}`, ErrorCodes.VERSION_MISMATCH));
        this.removeClient(client);
        return;
      }

      // Auth check
      if (this.authToken && frame.token !== this.authToken) {
        this.sendToClient(client, errResponse("_connect", "Authentication failed", ErrorCodes.AUTH_FAILED));
        this.removeClient(client);
        return;
      }

      client.authenticated = true;
      if (frame.clientId) {
        client.clientId = frame.clientId;
      }

      const result: ConnectResult = {
        type: "connected",
        version: PROTOCOL_VERSION,
        agentName: this.runtime.getState().currentTask?.title ?? "Cash-Claw",
        uptime: process.uptime(),
        toolCount: this.registry.getAll().length,
      };
      this.sendToClient(client, result);
      this.log.gateway(`WS client ${client.clientId} authenticated`);
      return;
    }

    // ─── RPC request ───────────────────────────────────────
    if (frame.type === "req") {
      // Must be authenticated
      if (!client.authenticated) {
        this.sendToClient(client, errResponse(frame.id, "Send connect frame first", ErrorCodes.HANDSHAKE_REQUIRED));
        return;
      }

      // Idempotency check
      if (frame.idempotencyKey) {
        const cacheKey = `${frame.method}:${frame.idempotencyKey}`;
        const cached = this.idempotencyCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          this.sendToClient(client, { ...cached.response, id: frame.id });
          return;
        }
      }

      // Dispatch RPC
      this.handleRpc(client, frame.id, frame.method, frame.params ?? {}, frame.idempotencyKey).catch(err => {
        this.sendToClient(client, errResponse(frame.id, err instanceof Error ? err.message : "Internal error", ErrorCodes.INTERNAL_ERROR));
      });
    }
  }

  private async handleRpc(
    client: WsClient,
    id: string,
    method: string,
    params: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void> {
    // Validate method exists
    const methodSchema = RpcParamsSchemas[method as RpcMethod];
    if (!methodSchema) {
      this.sendToClient(client, errResponse(id, `Unknown method: ${method}`, ErrorCodes.METHOD_NOT_FOUND));
      return;
    }

    // Validate params
    const paramsResult = methodSchema.safeParse(params);
    if (!paramsResult.success) {
      const errors = paramsResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
      this.sendToClient(client, errResponse(id, `Invalid params: ${errors}`, ErrorCodes.INVALID_FRAME));
      return;
    }

    const validParams = paramsResult.data as Record<string, unknown>;
    let response: ResponseMessage;

    switch (method as RpcMethod) {
      case "state.get":
        response = okResponse(id, this.runtime.getState());
        break;

      case "costs.get":
        response = okResponse(id, {
          session: this.costTracker.getSessionSummary(),
          todayCost: this.costTracker.getTodayCost(),
          remaining: this.costTracker.getRemainingBudget(),
          models: this.costTracker.getModelBreakdown(),
          tools: this.costTracker.getToolBreakdown(),
        });
        break;

      case "tools.list": {
        const category = validParams.category as string | undefined;
        const tools = category
          ? this.registry.getByCategory(category as ToolCategory)
          : this.registry.getAll();
        response = okResponse(id, {
          total: tools.length,
          tools: tools.map(t => ({
            name: t.name,
            category: t.category,
            description: t.description,
            readOnly: t.isReadOnly(),
            concurrencySafe: t.isConcurrencySafe(),
          })),
        });
        break;
      }

      case "skills.list":
        response = okResponse(id, {
          skills: this.skills?.getSkills().map(s => ({
            id: s.id,
            name: s.name,
            category: s.category,
            description: s.description,
            estimatedMinutes: s.estimatedMinutes,
            estimatedRevenue: s.estimatedRevenue,
          })) ?? [],
        });
        break;

      case "session.get":
        response = okResponse(id, {
          id: this.session.getSessionId(),
          status: this.session.getStatus(),
          messages: this.session.getMessages().length,
        });
        break;

      case "control.action": {
        const action = validParams.action as string;
        response = this.handleControlAction(id, action);
        break;
      }

      case "agent.plan":
        this.runtime.triggerCycle();
        response = okResponse(id, { message: "Cycle triggered" });
        break;

      case "agent.chat": {
        const message = validParams.message as string;
        try {
          const reply = await this.runtime.handleOperatorMessage(message);
          response = okResponse(id, { reply });
        } catch (err) {
          response = errResponse(id, err instanceof Error ? err.message : "Chat failed", ErrorCodes.INTERNAL_ERROR);
        }
        break;
      }

      default:
        response = errResponse(id, `Unknown method: ${method}`, ErrorCodes.METHOD_NOT_FOUND);
    }

    // Cache idempotent responses for 5 minutes
    if (idempotencyKey) {
      const cacheKey = `${method}:${idempotencyKey}`;
      this.idempotencyCache.set(cacheKey, {
        response,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
    }

    this.sendToClient(client, response);
  }

  private handleControlAction(id: string, action: string): ResponseMessage {
    switch (action) {
      case "pause":
        this.runtime.pause();
        return okResponse(id, { message: "Agent paused" });
      case "resume":
        this.runtime.resume();
        return okResponse(id, { message: "Agent resumed" });
      case "cycle":
        this.runtime.triggerCycle();
        return okResponse(id, { message: "Cycle triggered" });
      case "stop":
        setTimeout(() => process.emit("SIGTERM"), 100);
        return okResponse(id, { message: "Gateway stopping..." });
      case "reflect":
        if (this.reflection) {
          this.reflection.runNow().catch(() => {});
          return okResponse(id, { message: "Reflection started" });
        }
        return errResponse(id, "Reflection not available", ErrorCodes.SERVICE_UNAVAILABLE);
      default:
        return errResponse(id, `Unknown action: ${action}`, ErrorCodes.INVALID_FRAME);
    }
  }

  // ─── HTTP Request Handler ────────────────────────────────────

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);

    // Stripe webhook does NOT require auth (uses own signature verification)
    if (url.pathname === "/webhook/stripe" && req.method === "POST") {
      this.handleStripeWebhook(req, res);
      return;
    }

    // Auth check for REST endpoints (except dashboard)
    if (url.pathname !== "/" && this.authToken && !this.checkRestAuth(req)) {
      this.respondJson(res, 401, { error: "Unauthorized" });
      return;
    }

    try {
      switch (url.pathname) {
        case "/":
          // Serve dashboard HTML
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(getDashboardHtml(this.port, this.authToken));
          break;

        case "/health":
          this.respondJson(res, 200, {
            status: "ok",
            version: "0.1.0",
            protocol: PROTOCOL_VERSION,
            uptime: process.uptime(),
          });
          break;

        case "/api/state":
          this.respondJson(res, 200, this.runtime.getState());
          break;

        case "/api/costs":
          this.respondJson(res, 200, {
            session: this.costTracker.getSessionSummary(),
            todayCost: this.costTracker.getTodayCost(),
            remaining: this.costTracker.getRemainingBudget(),
            models: this.costTracker.getModelBreakdown(),
            tools: this.costTracker.getToolBreakdown(),
          });
          break;

        case "/api/tools":
          this.respondJson(res, 200, {
            total: this.registry.getAll().length,
            tools: this.registry.getAll().map(t => ({
              name: t.name,
              category: t.category,
              description: t.description,
              readOnly: t.isReadOnly(),
              concurrencySafe: t.isConcurrencySafe(),
            })),
          });
          break;

        case "/api/skills":
          this.respondJson(res, 200, {
            skills: this.skills?.getSkills().map(s => ({
              id: s.id,
              name: s.name,
              category: s.category,
              description: s.description,
              estimatedMinutes: s.estimatedMinutes,
              estimatedRevenue: s.estimatedRevenue,
            })) ?? [],
          });
          break;

        case "/api/session":
          this.respondJson(res, 200, {
            id: this.session.getSessionId(),
            status: this.session.getStatus(),
            messages: this.session.getMessages().length,
          });
          break;

        case "/api/control":
          if (req.method !== "POST") {
            this.respondJson(res, 405, { error: "POST required" });
            break;
          }
          this.handleRestControl(req, res);
          return;

        case "/api/chat":
          if (req.method !== "POST") {
            this.respondJson(res, 405, { error: "POST required" });
            break;
          }
          this.handleRestChat(req, res);
          return;

        case "/api/export/costs": {
          const fmt = url.searchParams.get("format") ?? "json";
          this.handleExportCosts(res, fmt);
          break;
        }

        case "/api/export/tasks": {
          const fmt = url.searchParams.get("format") ?? "json";
          this.handleExportTasks(res, fmt);
          break;
        }

        case "/api/revenue":
          if (this.dashboardData) {
            this.dashboardData.getRevenueSummary().then(data => {
              this.respondJson(res, 200, { success: true, data, timestamp: new Date().toISOString() });
            }).catch(err => {
              this.respondJson(res, 500, { success: false, error: err instanceof Error ? err.message : "Revenue fetch failed" });
            });
            return;
          }
          this.respondJson(res, 200, { success: true, data: { today: 0, thisWeek: 0, thisMonth: 0, recentPayments: [], dailyRevenue: [], categories: {} }, timestamp: new Date().toISOString() });
          break;

        case "/api/tools/stats":
          if (this.dashboardData) {
            this.dashboardData.getSandboxStatus().then(sandbox => {
              this.respondJson(res, 200, { success: true, tools: this.dashboardData!.getToolStats(), sandbox, timestamp: new Date().toISOString() });
            }).catch(() => {
              this.respondJson(res, 200, { success: true, tools: this.dashboardData!.getToolStats(), sandbox: { available: false, enabled: false, version: "N/A" }, timestamp: new Date().toISOString() });
            });
            return;
          }
          this.respondJson(res, 200, { success: true, tools: [], sandbox: { available: false, enabled: false, version: "N/A" }, timestamp: new Date().toISOString() });
          break;

        case "/api/reflections":
          this.respondJson(res, 200, { success: true, reflections: [], timestamp: new Date().toISOString() });
          break;

        case "/api/config":
          if (this.dashboardData) {
            this.respondJson(res, 200, { success: true, data: this.dashboardData.getMaskedConfig(), timestamp: new Date().toISOString() });
          } else {
            this.respondJson(res, 200, { success: true, data: {}, timestamp: new Date().toISOString() });
          }
          break;

        case "/api/logs": {
          const limit = Number(url.searchParams.get("limit") ?? "100");
          if (this.dashboardData) {
            this.respondJson(res, 200, { success: true, logs: this.dashboardData.getRecentLogs(limit), timestamp: new Date().toISOString() });
          } else {
            this.respondJson(res, 200, { success: true, logs: [], timestamp: new Date().toISOString() });
          }
          break;
        }

        default:
          this.respondJson(res, 404, { error: "Not found" });
      }
    } catch (err) {
      this.respondJson(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
    }
  }

  private handleRestControl(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const { action } = JSON.parse(body) as { action: string };
        const result = this.handleControlAction("rest", action);
        if (result.ok) {
          this.respondJson(res, 200, { ok: true, message: result.payload });
        } else {
          const status = result.code === ErrorCodes.SERVICE_UNAVAILABLE ? 503 : 400;
          this.respondJson(res, status, { error: result.error });
        }
      } catch {
        this.respondJson(res, 400, { error: "Invalid JSON in request body" });
      }
    });
  }

  // ─── Chat Handler ────────────────────────────────────────────

  private handleRestChat(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const { message } = JSON.parse(body) as { message: string };
        if (!message || typeof message !== "string") {
          this.respondJson(res, 400, { error: "Missing 'message' field" });
          return;
        }
        this.runtime.handleOperatorMessage(message).then(reply => {
          this.respondJson(res, 200, { reply });
        }).catch(err => {
          this.respondJson(res, 500, { error: err instanceof Error ? err.message : "Chat failed" });
        });
      } catch {
        this.respondJson(res, 400, { error: "Invalid JSON in request body" });
      }
    });
  }

  // ─── Stripe Webhook Handler ─────────────────────────────────

  private handleStripeWebhook(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        // Verify Stripe signature if webhook secret is configured
        const webhookSecret = this.stripeWebhookSecret;
        if (webhookSecret) {
          const sigHeader = req.headers["stripe-signature"] as string | undefined;
          if (!sigHeader) {
            this.respondJson(res, 400, { error: "Missing stripe-signature header" });
            return;
          }
          // Stripe signature verification (v1 scheme)
          const parts = sigHeader.split(",").reduce((acc, part) => {
            const [k, v] = part.split("=");
            if (k === "t") acc.timestamp = v;
            if (k === "v1") acc.signatures.push(v);
            return acc;
          }, { timestamp: "", signatures: [] as string[] });

          const signedPayload = `${parts.timestamp}.${body}`;
          const expectedSig = crypto.createHmac("sha256", webhookSecret)
            .update(signedPayload)
            .digest("hex");

          const valid = parts.signatures.some(sig =>
            crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex")),
          );

          if (!valid) {
            this.respondJson(res, 400, { error: "Invalid signature" });
            return;
          }

          // Reject events older than 5 minutes
          const tsAge = Math.abs(Date.now() / 1000 - Number(parts.timestamp));
          if (tsAge > 300) {
            this.respondJson(res, 400, { error: "Timestamp too old" });
            return;
          }
        }

        const event = JSON.parse(body) as { type: string; data?: { object?: { amount?: number; currency?: string; status?: string } } };
        this.log.gateway(`Stripe webhook: ${event.type}`);

        // Track revenue from successful payments
        if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
          const amount = event.data?.object?.amount;
          if (amount && typeof amount === "number") {
            const amountDecimal = amount / 100; // Stripe amounts are in cents
            this.log.ok(`💰 Stripe Zahlung eingegangen: ${amountDecimal} ${event.data?.object?.currency ?? "eur"}`);
            this.broadcast("cost_update", { stripePayment: amountDecimal, currency: event.data?.object?.currency });
          }
        }

        this.respondJson(res, 200, { received: true });
      } catch {
        this.respondJson(res, 400, { error: "Invalid JSON" });
      }
    });
  }

  // ─── Export Handlers ────────────────────────────────────────

  private handleExportCosts(res: http.ServerResponse, format: string): void {
    const data = {
      session: this.costTracker.getSessionSummary(),
      todayCost: this.costTracker.getTodayCost(),
      remaining: this.costTracker.getRemainingBudget(),
      models: this.costTracker.getModelBreakdown(),
      tools: this.costTracker.getToolBreakdown(),
    };

    if (format === "csv") {
      const rows = [["model", "calls", "inputTokens", "outputTokens", "costUsd", "errors"].join(",")];
      for (const [model, usage] of Object.entries(data.models)) {
        rows.push([model, usage.calls, usage.inputTokens, usage.outputTokens, usage.costUsd.toFixed(6), usage.errors].join(","));
      }
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=costs.csv",
      });
      res.end(rows.join("\n"));
    } else {
      this.respondJson(res, 200, data);
    }
  }

  private handleExportTasks(res: http.ServerResponse, format: string): void {
    const state = this.runtime.getState();
    const tasks = state.tasksCompleted ?? [];

    if (format === "csv") {
      const rows = [["title", "taskId", "success", "durationMs"].join(",")];
      for (const t of tasks) {
        rows.push([
          `"${(t.title ?? "").replace(/"/g, '""')}"`,
          String(t.taskId ?? ""),
          t.success ? "true" : "false",
          String(t.durationMs ?? ""),
        ].join(","));
      }
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=tasks.csv",
      });
      res.end(rows.join("\n"));
    } else {
      this.respondJson(res, 200, { tasks });
    }
  }

  // ─── Auth ───────────────────────────────────────────────────

  private checkRestAuth(req: http.IncomingMessage): boolean {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return false;
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return false;
    return parts[1] === this.authToken;
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private sendToClient(client: WsClient, data: unknown): void {
    try {
      sendWsFrame(client.socket, JSON.stringify(data));
    } catch {
      this.removeClient(client);
    }
  }

  private respondJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  }

  private removeClient(client: WsClient): void {
    const idx = this.wsClients.indexOf(client);
    if (idx >= 0) {
      this.wsClients.splice(idx, 1);
      try { client.socket.destroy(); } catch { /* ignore */ }
      this.log.gateway(`WS client ${client.clientId} disconnected (${this.wsClients.length} active)`);
    }
  }

  private pingClients(): void {
    for (const client of [...this.wsClients]) {
      if (!client.alive) {
        this.removeClient(client);
        continue;
      }
      client.alive = false;
      try {
        client.socket.write(Buffer.from([0x89, 0x00]));
      } catch {
        this.removeClient(client);
      }
    }
  }

  private cleanIdempotencyCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.idempotencyCache) {
      if (entry.expiresAt <= now) {
        this.idempotencyCache.delete(key);
      }
    }
  }
}
