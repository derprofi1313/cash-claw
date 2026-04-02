# CashClaw – Codebase Context für KI-Agenten

## Repo & Setup

```bash
git clone https://github.com/derprofi1313/cash-claw.git
cd cash-claw
pnpm install
pnpm build      # TypeScript kompilieren
pnpm dev        # Development mode
pnpm test       # Tests ausführen
```

---

## Architektur-Übersicht

```
cash-claw/
├── src/
│   ├── index.ts                    # Entry Point
│   ├── core.test.ts               # Core Tests
│   ├── cli/                       # CLI + Onboarding
│   │   └── onboarding.ts          # 8-Schritt Setup-Wizard
│   ├── config/                    # Konfiguration
│   │   └── types.ts               # CashClawConfig Interface
│   ├── gateway/                   # Core Runtime
│   │   ├── AgentRuntime.ts        # ⭐ AEL (Observe→Plan→Execute→Reflect)
│   │   ├── HttpGateway.ts         # REST API + WebSocket Server
│   │   ├── GatewayServer.ts       # Server-Lifecycle-Management
│   │   ├── LLMAdapter.ts          # Multi-Provider LLM Router
│   │   ├── TelegramAdapter.ts     # ✅ FERTIG – Vorlage für WhatsApp!
│   │   ├── OpenClawAdapter.ts     # OpenClaw Framework-Bridge
│   │   ├── BrowserAdapter.ts      # Browser Automation
│   │   ├── MonetizationSkills.ts  # Revenue-Strategien
│   │   ├── DailyReflection.ts     # Tages-Reflexions-Loop
│   │   ├── LearningSystem.ts      # Agent Learning/Memory
│   │   ├── CostTracker.ts         # LLM-Kosten Tracking
│   │   ├── SessionManager.ts      # Session Management
│   │   ├── SubAgentManager.ts     # Nested Agents
│   │   ├── BootstrapManager.ts    # Agent Identity
│   │   ├── GatewayLogger.ts       # Logging
│   │   ├── GogAdapter.ts          # GOG Integration
│   │   ├── dashboard.ts           # ⚠️ AUSBAUFÄHIG – Phase 9
│   │   ├── types.ts               # Shared Types
│   │   └── protocol/              # WebSocket Protocol v1 Schemas
│   └── tools/                     # 39 Tools in 9 Kategorien
│       ├── Tool.ts                # Base Tool Class
│       ├── ToolRegistry.ts        # Tool Registration
│       ├── agent/                 # Agent Spawn Tools
│       ├── browser/               # Browser Automation
│       ├── cron/                  # Scheduled Tasks
│       ├── fs/                    # File System Operations
│       ├── gog/                   # GOG Tools
│       ├── learning/              # Learning Tools
│       ├── openclaw/              # OpenClaw Tools
│       ├── stripe/                # Stripe Payment Tools
│       └── telegram/              # Telegram Tools
├── bootstrap/                     # Agent Identity Files
├── .github/workflows/             # CI/CD (CodeQL + Build)
├── package.json
└── tsconfig.json
```

---

## Wichtige Interfaces (aus types.ts)

```typescript
// AgentRuntime State
interface AgentState {
  phase: 'observe' | 'plan' | 'execute' | 'reflect' | 'idle'
  currentTask?: string
  isPaused: boolean
}

// Operator Commands (Telegram + neu: WhatsApp)
type OperatorCommand =
  | '/status' | '/pause' | '/resume'
  | '/plan' | '/reflect' | '/log'
  | '/stop' | '/help'

// Tool Base Interface
abstract class Tool {
  abstract name: string
  abstract description: string
  abstract execute(params: unknown): Promise<ToolResult>
}

interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}
```

---

## Bestehende Config-Struktur (config/types.ts)

```typescript
interface CashClawConfig {
  llm: {
    provider: 'anthropic' | 'openai' | 'google' | 'ollama'
    model: string
    apiKey?: string
  }
  telegram?: {
    enabled: boolean
    botToken: string
    operatorChatId: string
  }
  stripe?: {
    secretKey: string
    webhookSecret?: string
  }
  monetization: {
    categories: ('email' | 'content' | 'leads' | 'finance' | 'products')[]
    dailyBudgetUSD: number
    maxCostPerTaskUSD: number
  }
  workHours: {
    start: number  // 0-23
    end: number    // 0-23
    timezone: string
  }
  // Phase 7 hinzufügen: whatsapp?
  // Phase 8 hinzufügen: sandbox?
}
```

---

## HTTP Gateway Endpoints (bestehend)

```
GET  /           → Dashboard HTML
GET  /health     → { status: 'ok', uptime: number }
WS   /ws         → WebSocket Live-Updates
```

*Phase 9 ergänzt: /api/* Endpoints (siehe phase-09-dashboard.md)*

---

## TelegramAdapter als Vorlage für WhatsApp

Der Telegram-Adapter (`src/gateway/TelegramAdapter.ts`) ist die **perfekte Vorlage** für den WhatsApp-Adapter. Er zeigt:

1. Wie `AgentRuntime.handleOperatorCommand()` aufgerufen wird
2. Wie Operator-Whitelist implementiert ist
3. Wie Start/Stop/Reconnect funktioniert
4. Wie Messages formatiert werden

**Lies `TelegramAdapter.ts` zuerst, bevor du `WhatsAppAdapter.ts` schreibst!**

---

## Coding Guidelines

```typescript
// ✅ GUT: Strikte Types
interface WhatsAppMessage {
  from: string
  body: string
  timestamp: Date
}

// ❌ SCHLECHT: any
function handleMessage(msg: any) { ... }

// ✅ GUT: Descriptive Errors
throw new Error(`WhatsApp: Invalid operator number format. Expected E.164 (e.g. +491234567890), got: ${number}`)

// ✅ GUT: Defensive API Key Logging
logger.info(`Stripe key loaded: sk_***${key.slice(-4)}`)

// ✅ GUT: Graceful Fallback
const dockerAvailable = await DockerSandbox.isDockerAvailable()
if (!dockerAvailable) {
  logger.warn('Docker not available – running tools without sandbox')
}
```

---

## Häufige Patterns im Codebase

```typescript
// Logger (GatewayLogger)
const logger = new GatewayLogger('WhatsAppAdapter')
logger.info('Connected')
logger.warn('Reconnecting...')
logger.error('Failed', error)

// Config Persistenz
import { loadConfig, saveConfig } from '../config'
const config = await loadConfig()

// Event Bus (für WebSocket broadcasts)
this.runtime.emit('tool_call', { tool: 'send_whatsapp_message', duration: 123 })
```

---

## Nützliche Links

- **Baileys Docs:** https://github.com/WhiskeySockets/Baileys
- **Dockerode Docs:** https://github.com/apocas/dockerode
- **OpenClaw Source:** https://github.com/openclaw/openclaw
- **Stripe Node SDK:** https://github.com/stripe/stripe-node
