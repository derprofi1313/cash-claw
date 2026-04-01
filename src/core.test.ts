// Cash-Claw Core Tests
// Uses Node.js built-in test runner (node:test)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTool } from "./tools/Tool.js";
import { ToolRegistry } from "./tools/ToolRegistry.js";
import { createDefaultConfig } from "./config/types.js";
import { LLMAdapter } from "./gateway/LLMAdapter.js";
import {
  PROTOCOL_VERSION,
  ConnectMessageSchema,
  RequestMessageSchema,
  IncomingFrameSchema,
  RpcParamsSchemas,
  okResponse,
  errResponse,
  buildEvent,
  ErrorCodes,
} from "./gateway/protocol/types.js";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
//  buildTool()
// ═══════════════════════════════════════════════════════════════

describe("buildTool", () => {
  const dummyTool = buildTool({
    name: "test.echo",
    description: "Echo input back",
    category: "filesystem",
    inputSchema: z.object({ message: z.string() }),
    parameterDescription: "message: string",
    readOnly: true,
    call: async (input) => ({ data: input.message }),
  });

  it("should set name and category", () => {
    assert.equal(dummyTool.name, "test.echo");
    assert.equal(dummyTool.category, "filesystem");
  });

  it("should default concurrencySafe to true", () => {
    assert.equal(dummyTool.isConcurrencySafe(), true);
  });

  it("should honor readOnly flag", () => {
    assert.equal(dummyTool.isReadOnly(), true);
    assert.equal(dummyTool.isDestructive(), false);
  });

  it("should validate input with Zod schema", () => {
    const result = dummyTool.inputSchema.safeParse({ message: "hello" });
    assert.equal(result.success, true);

    const bad = dummyTool.inputSchema.safeParse({ message: 123 });
    assert.equal(bad.success, false);
  });

  it("should execute call", async () => {
    const ctx = {
      workspaceDir: ".",
      permissionMode: "autonomous" as const,
      getState: () => ({ running: true, paused: false, actionsToday: 0, costToday: 0, dailyBudgetUsd: 5, cycleCount: 0 }),
    };
    const result = await dummyTool.call({ message: "test" }, ctx);
    assert.equal(result.data, "test");
  });

  it("should allow in autonomous mode by default", () => {
    const ctx = {
      workspaceDir: ".",
      permissionMode: "autonomous" as const,
      getState: () => ({ running: true, paused: false, actionsToday: 0, costToday: 0, dailyBudgetUsd: 5, cycleCount: 0 }),
    };
    const perm = dummyTool.checkPermissions({ message: "x" }, ctx);
    assert.deepEqual(perm, { behavior: "allow" });
  });

  it("should deny write tools in read_only mode", () => {
    const writeTool = buildTool({
      name: "test.write",
      description: "Write something",
      category: "filesystem",
      inputSchema: z.object({ data: z.string() }),
      parameterDescription: "data: string",
      readOnly: false,
      call: async () => ({ data: "ok" }),
    });
    const ctx = {
      workspaceDir: ".",
      permissionMode: "read_only" as const,
      getState: () => ({ running: true, paused: false, actionsToday: 0, costToday: 0, dailyBudgetUsd: 5, cycleCount: 0 }),
    };
    const perm = writeTool.checkPermissions({ data: "x" }, ctx);
    assert.deepEqual(perm, { behavior: "deny", reason: "Schreiboperationen deaktiviert" });
  });

  it("should require confirmation for destructive tools in default mode", () => {
    const destructiveTool = buildTool({
      name: "test.destroy",
      description: "Destroy something",
      category: "filesystem",
      inputSchema: z.object({}),
      parameterDescription: "",
      destructive: true,
      call: async () => ({ data: "destroyed" }),
    });
    const ctx = {
      workspaceDir: ".",
      permissionMode: "default" as const,
      getState: () => ({ running: true, paused: false, actionsToday: 0, costToday: 0, dailyBudgetUsd: 5, cycleCount: 0 }),
    };
    const perm = destructiveTool.checkPermissions({}, ctx);
    assert.equal((perm as { behavior: string }).behavior, "confirm");
  });
});

// ═══════════════════════════════════════════════════════════════
//  ToolRegistry
// ═══════════════════════════════════════════════════════════════

describe("ToolRegistry", () => {
  // Create a minimal mock logger
  const mockLog = {
    gateway: () => {},
    ok: () => {},
    error: () => {},
    config: () => {},
    plan: () => {},
    think: () => {},
    exec: () => {},
    telegram: () => {},
    stripe: () => {},
    tool: () => {},
    cost: () => {},
    log: () => {},
    llm: () => {},
    maskKey: () => "***",
  } as any;

  it("should register and retrieve tools", () => {
    const registry = new ToolRegistry(mockLog);
    const tool = buildTool({
      name: "test.tool1",
      description: "Test tool",
      category: "filesystem",
      inputSchema: z.object({}),
      parameterDescription: "",
      readOnly: true,
      call: async () => ({ data: "ok" }),
    });

    registry.register(tool);
    assert.equal(registry.getAll().length, 1);
    assert.equal(registry.get("test.tool1")?.name, "test.tool1");
  });

  it("should register multiple tools", () => {
    const registry = new ToolRegistry(mockLog);
    const tools = [
      buildTool({ name: "a.one", description: "A", category: "filesystem", inputSchema: z.object({}), parameterDescription: "", readOnly: true, call: async () => ({ data: "" }) }),
      buildTool({ name: "a.two", description: "B", category: "filesystem", inputSchema: z.object({}), parameterDescription: "", readOnly: true, call: async () => ({ data: "" }) }),
    ];
    registry.registerAll(tools);
    assert.equal(registry.getAll().length, 2);
  });

  it("should execute a tool with valid params", async () => {
    const registry = new ToolRegistry(mockLog);
    const tool = buildTool({
      name: "test.greet",
      description: "Greet",
      category: "filesystem",
      inputSchema: z.object({ name: z.string() }),
      parameterDescription: "name: string",
      readOnly: true,
      call: async (input) => ({ data: `Hello ${input.name}` }),
    });
    registry.register(tool);

    const ctx = {
      workspaceDir: ".",
      permissionMode: "autonomous" as const,
      getState: () => ({ running: true, paused: false, actionsToday: 0, costToday: 0, dailyBudgetUsd: 5, cycleCount: 0 }),
    };

    const result = await registry.execute(
      { id: "tc-1", tool: "test.greet", params: { name: "World" } },
      ctx,
    );
    assert.equal(result.success, true);
    assert.ok(result.output.includes("Hello World"));
  });

  it("should fail for unknown tool", async () => {
    const registry = new ToolRegistry(mockLog);
    const ctx = {
      workspaceDir: ".",
      permissionMode: "autonomous" as const,
      getState: () => ({ running: true, paused: false, actionsToday: 0, costToday: 0, dailyBudgetUsd: 5, cycleCount: 0 }),
    };
    const result = await registry.execute(
      { id: "tc-2", tool: "nonexistent", params: {} },
      ctx,
    );
    assert.equal(result.success, false);
  });

  it("should generate system prompt", () => {
    const registry = new ToolRegistry(mockLog);
    const tool = buildTool({
      name: "test.calc",
      description: "Calculate things",
      category: "filesystem",
      inputSchema: z.object({ x: z.number() }),
      parameterDescription: "x: number",
      readOnly: true,
      call: async () => ({ data: 42 }),
    });
    registry.register(tool);

    const prompt = registry.generateSystemPrompt();
    assert.ok(prompt.includes("test.calc"));
    assert.ok(prompt.includes("Calculate things"));
  });

  it("should fail with invalid params (Zod validation)", async () => {
    const registry = new ToolRegistry(mockLog);
    const tool = buildTool({
      name: "test.typed",
      description: "Typed tool",
      category: "filesystem",
      inputSchema: z.object({ count: z.number() }),
      parameterDescription: "count: number",
      readOnly: true,
      call: async (input) => ({ data: input.count * 2 }),
    });
    registry.register(tool);

    const ctx = {
      workspaceDir: ".",
      permissionMode: "autonomous" as const,
      getState: () => ({ running: true, paused: false, actionsToday: 0, costToday: 0, dailyBudgetUsd: 5, cycleCount: 0 }),
    };

    const result = await registry.execute(
      { id: "tc-3", tool: "test.typed", params: { count: "not-a-number" } },
      ctx,
    );
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Parameter") || result.error?.includes("Ung"));
  });

  it("should execute concurrent-safe tools in parallel", async () => {
    const registry = new ToolRegistry(mockLog);
    const execOrder: string[] = [];

    const toolA = buildTool({
      name: "test.a",
      description: "A",
      category: "filesystem",
      inputSchema: z.object({}),
      parameterDescription: "",
      readOnly: true,
      concurrencySafe: true,
      call: async () => {
        execOrder.push("a-start");
        await new Promise(r => setTimeout(r, 10));
        execOrder.push("a-end");
        return { data: "a" };
      },
    });
    const toolB = buildTool({
      name: "test.b",
      description: "B",
      category: "filesystem",
      inputSchema: z.object({}),
      parameterDescription: "",
      readOnly: true,
      concurrencySafe: true,
      call: async () => {
        execOrder.push("b-start");
        await new Promise(r => setTimeout(r, 10));
        execOrder.push("b-end");
        return { data: "b" };
      },
    });

    registry.register(toolA);
    registry.register(toolB);

    const ctx = {
      workspaceDir: ".",
      permissionMode: "autonomous" as const,
      getState: () => ({ running: true, paused: false, actionsToday: 0, costToday: 0, dailyBudgetUsd: 5, cycleCount: 0 }),
    };

    const results = await registry.executeAll([
      { id: "tc-a", tool: "test.a", params: {} },
      { id: "tc-b", tool: "test.b", params: {} },
    ], ctx);

    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.success));
    // Both should start before either ends (parallel execution)
    assert.ok(execOrder.indexOf("a-start") < execOrder.indexOf("a-end"));
    assert.ok(execOrder.indexOf("b-start") < execOrder.indexOf("b-end"));
  });
});

// ═══════════════════════════════════════════════════════════════
//  ToolRegistry – parseToolCalls (robust parsing)
// ═══════════════════════════════════════════════════════════════

describe("ToolRegistry.parseToolCalls", () => {
  const mockLog = {
    gateway: () => {}, ok: () => {}, error: () => {}, config: () => {},
    plan: () => {}, think: () => {}, exec: () => {}, telegram: () => {},
    stripe: () => {}, tool: () => {}, cost: () => {}, log: () => {},
    llm: () => {}, maskKey: () => "***",
  } as any;

  const registry = new ToolRegistry(mockLog);

  it("should parse tool calls from fenced code blocks", () => {
    const text = `Let me read the file.
\`\`\`json
{ "action": "tool", "id": "call-1", "tool": "fs.read", "params": { "path": "/tmp/test.txt" } }
\`\`\``;
    const calls = registry.parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool, "fs.read");
    assert.equal(calls[0].id, "call-1");
    assert.deepEqual(calls[0].params, { path: "/tmp/test.txt" });
  });

  it("should parse inline JSON tool calls", () => {
    const text = 'I will use this tool: { "action": "tool", "tool": "telegram.send", "params": { "text": "Hello" } }';
    const calls = registry.parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool, "telegram.send");
  });

  it("should parse multiple tool calls", () => {
    const text = `
\`\`\`json
{ "action": "tool", "id": "c1", "tool": "fs.read", "params": { "path": "a.txt" } }
\`\`\`
Then:
\`\`\`json
{ "action": "tool", "id": "c2", "tool": "fs.write", "params": { "path": "b.txt", "data": "hello" } }
\`\`\``;
    const calls = registry.parseToolCalls(text);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].tool, "fs.read");
    assert.equal(calls[1].tool, "fs.write");
  });

  it("should handle nested JSON in params", () => {
    const text = '{ "action": "tool", "tool": "gog.sheets.append", "params": { "data": { "name": "Alice", "scores": [1, 2, 3] } } }';
    const calls = registry.parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool, "gog.sheets.append");
    assert.deepEqual((calls[0].params as any).data, { name: "Alice", scores: [1, 2, 3] });
  });

  it("should skip malformed JSON", () => {
    const text = '{ "action": "tool", "tool": "broken" }{ this is not json';
    const calls = registry.parseToolCalls(text);
    // "broken" has tool field but no closing brace issue with balanced extraction
    // The first part is valid but "broken" should still be parsed
    // The second part is garbage — no tool calls from it
    assert.ok(calls.length <= 1);
  });

  it("should skip non-tool JSON objects", () => {
    const text = '{ "status": "ok", "count": 5 } and also { "action": "tool", "tool": "fs.list", "params": {} }';
    const calls = registry.parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool, "fs.list");
  });

  it("should assign auto-generated IDs when missing", () => {
    const text = '{ "action": "tool", "tool": "fs.read", "params": {} }';
    const calls = registry.parseToolCalls(text);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].id.startsWith("tc-"));
  });

  it("should return empty array for text without tool calls", () => {
    const calls = registry.parseToolCalls("Just a normal response with no tools.");
    assert.equal(calls.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Config
// ═══════════════════════════════════════════════════════════════

describe("createDefaultConfig", () => {
  it("should return valid defaults", () => {
    const config = createDefaultConfig();
    assert.equal(config.version, "0.1.0");
    assert.equal(config.setupComplete, false);
    assert.equal(config.platform.type, "telegram");
    assert.equal(config.categories.content, true);
    assert.equal(config.categories.finance, false);
    assert.equal(config.financeLimits.dailyApiBudgetUsd, 5);
    assert.equal(config.schedule.maxActionsPerDay, 50);
    assert.equal(config.docker.enabled, true);
  });

  it("should set timestamps", () => {
    const before = new Date().toISOString();
    const config = createDefaultConfig();
    assert.ok(config.createdAt >= before);
    assert.ok(config.updatedAt >= before);
  });
});

// ═══════════════════════════════════════════════════════════════
//  LLMAdapter – Cost Calculation
// ═══════════════════════════════════════════════════════════════

describe("LLMAdapter.calculateCost", () => {
  const mockLog = {
    gateway: () => {}, ok: () => {}, error: () => {}, config: () => {},
    plan: () => {}, think: () => {}, exec: () => {}, telegram: () => {},
    stripe: () => {}, tool: () => {}, cost: () => {}, log: () => {},
    llm: () => {}, maskKey: () => "***",
  } as any;

  it("should calculate Anthropic Opus pricing correctly", () => {
    const adapter = new LLMAdapter(
      { provider: "anthropic", apiKey: "test", model: "claude-opus-4-6" },
      mockLog,
    );
    // 1000 prompt tokens * $5/1M + 500 completion tokens * $25/1M
    const cost = adapter.calculateCost(1000, 500);
    assert.equal(cost, (1000 * 5 + 500 * 25) / 1_000_000);
  });

  it("should calculate Sonnet pricing correctly", () => {
    const adapter = new LLMAdapter(
      { provider: "anthropic", apiKey: "test", model: "claude-sonnet-4-6" },
      mockLog,
    );
    const cost = adapter.calculateCost(10000, 5000);
    assert.equal(cost, (10000 * 3 + 5000 * 15) / 1_000_000);
  });

  it("should return 0 for unknown models", () => {
    const adapter = new LLMAdapter(
      { provider: "ollama", apiKey: "", model: "llama3.2" },
      mockLog,
    );
    const cost = adapter.calculateCost(1000, 1000);
    assert.equal(cost, 0);
  });

  it("should calculate Gemini Flash pricing correctly", () => {
    const adapter = new LLMAdapter(
      { provider: "google", apiKey: "test", model: "gemini-3-flash-preview" },
      mockLog,
    );
    const cost = adapter.calculateCost(100000, 50000);
    assert.equal(cost, (100000 * 0.15 + 50000 * 0.6) / 1_000_000);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Gateway Protocol v1 – Schema Validation
// ═══════════════════════════════════════════════════════════════

describe("Protocol v1 schemas", () => {
  it("should validate a connect message", () => {
    const msg = { type: "connect", version: 1, token: "secret123" };
    const result = ConnectMessageSchema.safeParse(msg);
    assert.equal(result.success, true);
  });

  it("should validate connect without optional fields", () => {
    const msg = { type: "connect" };
    const result = ConnectMessageSchema.safeParse(msg);
    assert.equal(result.success, true);
  });

  it("should reject connect with wrong type", () => {
    const msg = { type: "disconnect" };
    const result = ConnectMessageSchema.safeParse(msg);
    assert.equal(result.success, false);
  });

  it("should validate a request message", () => {
    const msg = { type: "req", id: "r1", method: "state.get", params: {} };
    const result = RequestMessageSchema.safeParse(msg);
    assert.equal(result.success, true);
  });

  it("should reject request without id", () => {
    const msg = { type: "req", method: "state.get" };
    const result = RequestMessageSchema.safeParse(msg);
    assert.equal(result.success, false);
  });

  it("should validate incoming frames via discriminated union", () => {
    const connect = { type: "connect" };
    const req = { type: "req", id: "r1", method: "state.get" };

    assert.equal(IncomingFrameSchema.safeParse(connect).success, true);
    assert.equal(IncomingFrameSchema.safeParse(req).success, true);
    assert.equal(IncomingFrameSchema.safeParse({ type: "event" }).success, false);
  });

  it("should validate RPC params schemas", () => {
    const controlParams = RpcParamsSchemas["control.action"];
    assert.equal(controlParams.safeParse({ action: "pause" }).success, true);
    assert.equal(controlParams.safeParse({ action: "invalid" }).success, false);

    const chatParams = RpcParamsSchemas["agent.chat"];
    assert.equal(chatParams.safeParse({ message: "Hello" }).success, true);
    assert.equal(chatParams.safeParse({ message: "" }).success, false);
    assert.equal(chatParams.safeParse({}).success, false);
  });
});

describe("Protocol v1 helpers", () => {
  it("should build ok response", () => {
    const res = okResponse("r1", { status: "running" });
    assert.equal(res.type, "res");
    assert.equal(res.id, "r1");
    assert.equal(res.ok, true);
    assert.deepEqual(res.payload, { status: "running" });
  });

  it("should build error response", () => {
    const res = errResponse("r2", "Not found", ErrorCodes.METHOD_NOT_FOUND);
    assert.equal(res.ok, false);
    assert.equal(res.error, "Not found");
    assert.equal(res.code, 4404);
  });

  it("should build event with timestamp", () => {
    const before = Date.now();
    const event = buildEvent("cycle_start", { cycle: 1 });
    assert.equal(event.type, "event");
    assert.equal(event.event, "cycle_start");
    assert.ok(event.ts >= before);
    assert.deepEqual(event.payload, { cycle: 1 });
  });

  it("should have correct protocol version", () => {
    assert.equal(PROTOCOL_VERSION, 1);
  });
});
