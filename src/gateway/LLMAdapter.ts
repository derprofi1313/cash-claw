// Unified LLM Adapter – routes to Anthropic, OpenAI, Google Gemini, or Ollama

import type { LLMMessage, LLMResponse } from "./types.js";
import type { GatewayLogger } from "./GatewayLogger.js";
import type { CashClawConfig } from "../config/types.js";

// ═══════════════════════════════════════════════════════════════
//  LLM API RESPONSE TYPES (replaces `any` casts)
// ═══════════════════════════════════════════════════════════════

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

interface AnthropicResponse {
  content?: Array<{ text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface OpenAIResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface OllamaResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

// ═══════════════════════════════════════════════════════════════
//  PRICING
// ═══════════════════════════════════════════════════════════════

/** Price per 1M tokens: { input, output } in USD */
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4-6":    { input: 5,    output: 25 },
  "claude-sonnet-4-6":  { input: 3,    output: 15 },
  "claude-haiku-4-5":   { input: 1,    output: 5 },
  // OpenAI
  "gpt-5.4":            { input: 2.5,  output: 15 },
  "gpt-5.4-mini":       { input: 0.75, output: 4.5 },
  "gpt-5.4-nano":       { input: 0.2,  output: 1.25 },
  // Google Gemini
  "gemini-3.1-pro-preview":  { input: 1.25, output: 5 },
  "gemini-3-flash-preview":  { input: 0.15, output: 0.6 },
  "gemini-2.5-pro":          { input: 1.25, output: 5 },
  "gemini-2.5-flash":        { input: 0.15, output: 0.6 },
};

// ═══════════════════════════════════════════════════════════════
//  LLM ADAPTER
// ═══════════════════════════════════════════════════════════════

export class LLMAdapter {
  private provider: string;
  private apiKey: string;
  private model: string;

  constructor(
    llmConfig: CashClawConfig["llm"],
    private log: GatewayLogger,
  ) {
    this.provider = llmConfig.provider;
    this.apiKey = llmConfig.apiKey;
    this.model = llmConfig.model;
  }

  getProvider(): string { return this.provider; }
  getModel(): string { return this.model; }

  /** Switch the active model (used for fallback) */
  setModel(model: string): void {
    this.log.llm(`Model switched: ${this.model} → ${model}`);
    this.model = model;
  }

  /** Quick connection test */
  async testConnection(): Promise<boolean> {
    try {
      this.log.llm(`Testing connection to ${this.provider}/${this.model}...`);
      const response = await this.send(
        [{ role: "user", content: "Antworte nur mit dem Wort OK." }],
      );
      const preview = response.text.trim().substring(0, 60);
      this.log.ok(`LLM connected: ${this.provider}/${this.model} → "${preview}"`);
      return true;
    } catch (err) {
      this.log.error(`LLM connection failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Send messages to the LLM and return response + token usage */
  async send(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    switch (this.provider) {
      case "google":    return this.sendGoogle(messages, systemPrompt);
      case "anthropic":  return this.sendAnthropic(messages, systemPrompt);
      case "openai":     return this.sendOpenAI(messages, systemPrompt);
      case "ollama":     return this.sendOllama(messages, systemPrompt);
      default: throw new Error(`Unknown LLM provider: ${this.provider}`);
    }
  }

  // ─── Google Gemini ─────────────────────────────────────────────

  private async sendGoogle(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const contents = messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = { contents };

    const sysText = systemPrompt ?? messages.find(m => m.role === "system")?.content;
    if (sysText) {
      body.systemInstruction = { parts: [{ text: sysText }] };
    }

    this.log.llm(`📤 Gemini (${this.model}) – ${contents.length} messages`);
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini ${res.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await res.json() as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    const cost = this.calculateCost(promptTokens, completionTokens);

    this.log.llm(`📥 ${promptTokens}+${completionTokens} tokens | $${cost.toFixed(4)}`);
    return { text, tokensUsed: { prompt: promptTokens, completion: completionTokens }, costUsd: cost };
  }

  // ─── Anthropic (Messages API) ─────────────────────────────────

  private async sendAnthropic(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const url = "https://api.anthropic.com/v1/messages";

    const sysText = systemPrompt ?? messages.find(m => m.role === "system")?.content;
    const userMessages = messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 8192,
      messages: userMessages,
    };
    if (sysText) body.system = sysText;

    this.log.llm(`📤 Anthropic (${this.model}) – ${userMessages.length} messages`);
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Anthropic ${res.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await res.json() as AnthropicResponse;
    const text = data.content?.[0]?.text ?? "";
    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;
    const cost = this.calculateCost(promptTokens, completionTokens);

    this.log.llm(`📥 ${promptTokens}+${completionTokens} tokens | $${cost.toFixed(4)}`);
    return { text, tokensUsed: { prompt: promptTokens, completion: completionTokens }, costUsd: cost };
  }

  // ─── OpenAI (Chat Completions) ────────────────────────────────

  private async sendOpenAI(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const url = "https://api.openai.com/v1/chat/completions";

    const allMessages: Array<{ role: string; content: string }> = [];
    const sysText = systemPrompt ?? messages.find(m => m.role === "system")?.content;
    if (sysText) {
      allMessages.push({ role: "system", content: sysText });
    }
    allMessages.push(
      ...messages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role, content: m.content })),
    );

    this.log.llm(`📤 OpenAI (${this.model}) – ${allMessages.length} messages`);
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages: allMessages }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await res.json() as OpenAIResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const cost = this.calculateCost(promptTokens, completionTokens);

    this.log.llm(`📥 ${promptTokens}+${completionTokens} tokens | $${cost.toFixed(4)}`);
    return { text, tokensUsed: { prompt: promptTokens, completion: completionTokens }, costUsd: cost };
  }

  // ─── Ollama (Local) ───────────────────────────────────────────

  private async sendOllama(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const url = "http://localhost:11434/api/chat";

    const allMessages: Array<{ role: string; content: string }> = [];
    const sysText = systemPrompt ?? messages.find(m => m.role === "system")?.content;
    if (sysText) {
      allMessages.push({ role: "system", content: sysText });
    }
    allMessages.push(
      ...messages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role, content: m.content })),
    );

    this.log.llm(`📤 Ollama (${this.model}) – ${allMessages.length} messages`);
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages: allMessages, stream: false }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Ollama ${res.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await res.json() as OllamaResponse;
    const text = data.message?.content ?? "";
    const promptTokens = data.prompt_eval_count ?? 0;
    const completionTokens = data.eval_count ?? 0;

    this.log.llm(`📥 ${promptTokens}+${completionTokens} tokens | $0.0000 (local)`);
    return { text, tokensUsed: { prompt: promptTokens, completion: completionTokens }, costUsd: 0 };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  calculateCost(promptTokens: number, completionTokens: number): number {
    const pricing = PRICING[this.model];
    if (!pricing) return 0;
    return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 120_000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
