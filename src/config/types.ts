// Cash-Claw Configuration Types
// Defines the shape of ~/.cashclaw/config.json

export interface ServiceDefinition {
  enabled: boolean;
  pricing: Record<string, number>;
  description: string;
}

export interface CashClawConfig {
  version: string;

  // Agent identity
  agent?: {
    name: string;
    owner: string;
    email: string;
    currency: string;
    created_at: string;
  };

  // Server settings
  server?: {
    port: number;
    host: string;
  };

  // LLM Provider
  llm: {
    provider: "anthropic" | "openai" | "google" | "ollama";
    apiKey: string;
    model: string;
  };

  // Chat Platform
  platform: {
    type: "telegram" | "whatsapp" | "both";
    telegram?: {
      botToken: string;
      operatorChatId: string;
    };
    whatsapp?: {
      operatorNumber: string;
      sessionPath?: string;
      reconnectAttempts?: number;
    };
  };

  // Stripe Payment
  stripe: {
    secretKey: string;
    secret_key?: string;
    webhookSecret?: string;
    minPayout: number;
    connected?: boolean;
    mode?: string;
  };

  // Services the agent can offer
  services?: Record<string, ServiceDefinition>;

  // Allowed monetization categories
  categories: {
    content: boolean;
    outreach: boolean;
    finance: boolean;
    products: boolean;
  };

  // Financial safety (only relevant if finance: true)
  financeLimits: {
    maxDailyRiskPercent: number;
    minBetEdgePercent: number;
    dailyApiBudgetUsd: number;
  };

  // Operating schedule
  schedule: {
    activeFrom: string;
    activeTo: string;
    maxActionsPerDay: number;
    planningIntervalMinutes: number;
  };

  // Docker sandboxing
  docker: {
    enabled: boolean;
    image?: string;
    memoryMB?: number;
    cpuPercent?: number;
    timeoutSeconds?: number;
    allowNetwork?: boolean;
    workspacePath?: string;
  };

  /** @planned Hyrve AI Marketplace integration */
  hyrve?: {
    api_key: string;
    api_url: string;
    enabled: boolean;
    registered: boolean;
    agent_id: string;
  };

  // Gog CLI (Google Workspace: Gmail, Calendar, Drive, Sheets, Docs)
  gog?: {
    account: string;
    enabled: boolean;
    credentialsPath?: string;
  };

  /** @planned OpenClaw integration */
  openclaw?: {
    workspace: string;
    skills_dir: string;
    auto_detected: boolean;
    install_dir?: string;
    standardSkills?: string[];
  };

  /** @planned Heartbeat monitoring */
  heartbeat?: {
    enabled: boolean;
    interval_ms: number;
  };

  // Runtime stats (updated by CostTracker on shutdown)
  stats?: {
    total_missions: number;
    completed_missions: number;
    total_earned: number;
  };

  // Internal
  debug: boolean;
  setupComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export function createDefaultConfig(): CashClawConfig {
  return {
    version: "0.1.0",
    llm: {
      provider: "anthropic",
      apiKey: "",
      model: "",
    },
    platform: {
      type: "telegram",
    },
    stripe: {
      secretKey: "",
      webhookSecret: "",
      minPayout: 50,
    },
    categories: {
      content: true,
      outreach: true,
      finance: false,
      products: true,
    },
    financeLimits: {
      maxDailyRiskPercent: 2,
      minBetEdgePercent: 5,
      dailyApiBudgetUsd: 5,
    },
    schedule: {
      activeFrom: "00:00",
      activeTo: "24:00",
      maxActionsPerDay: 50,
      planningIntervalMinutes: 15,
    },
    docker: {
      enabled: true,
    },
    debug: false,
    setupComplete: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
