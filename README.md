# Cash-Claw

**Autonomous AI revenue agent — built on [OpenClaw](https://github.com/openclaw/openclaw).**

[![CI](https://github.com/derprofi1313/cash-claw/actions/workflows/ci.yml/badge.svg)](https://github.com/derprofi1313/cash-claw/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.16-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

Cash-Claw extends OpenClaw with an **Autonomous Execution Loop (AEL)** — a self-driving planning and execution layer that discovers revenue streams, completes tasks, and collects payments without manual input. The underlying OpenClaw system (Gateway, Chat, Channels) remains fully intact.

---

## Quickstart

### Prerequisites

- **Node.js** 22.16+ (recommended: Node 24)
- **npm** or **pnpm**
- API key for at least one LLM provider (Anthropic, OpenAI, Google, or Ollama)
- Stripe account for payment processing
- Telegram Bot Token and/or WhatsApp number (for operator control)
- Docker (optional, for sandboxed tool execution)

### Installation

```bash
# From source:
git clone https://github.com/derprofi1313/cash-claw.git
cd cash-claw
npm install
npm run build
npm link   # makes 'cashclaw' available globally
```

### Setup

```bash
# Interactive setup wizard (recommended):
cashclaw onboard

# With live debug view:
cashclaw onboard --debug
```

The wizard guides you through 8 steps:

| Step | What's configured |
|------|-------------------|
| 1/8 | LLM provider + API key (validated live) |
| 2/8 | Chat platform: Telegram, WhatsApp, or both |
| 3/8 | Stripe Secret Key + Webhook Secret |
| 4/8 | Monetization categories |
| 5/8 | Financial safety limits (if Finance enabled) |
| 6/8 | Work hours + action limits |
| 7/8 | Docker sandboxing |
| 8/8 | Google Workspace (gog CLI) |

Every input is **immediately** saved to `~/.cashclaw/config.json` and validated against the real API.

---

## Commands

```bash
cashclaw onboard          # Run setup wizard
cashclaw onboard --debug  # Setup with live debug console
cashclaw gateway          # Start gateway (OpenClaw + AEL)
cashclaw gateway --debug  # Gateway with verbose logging
cashclaw status           # Show current system status
cashclaw --version        # Show version
cashclaw --help           # Show help
```

### Telegram Operator Commands

| Command | Action |
|---------|--------|
| `/status` | Show agent state |
| `/pause` | Pause AEL loop |
| `/resume` | Resume AEL loop |
| `/plan` | Trigger immediate planning cycle |
| `/reflect` | Trigger daily reflection now |
| `/log` | Show last 5 tasks |
| `/stop` | Shutdown gateway |
| `/help` | Command list |

The same commands work on **WhatsApp** when configured.

### Web Dashboard

Cash-Claw includes a full web dashboard at `http://127.0.0.1:18789/` with:

- **Overview** — Live activity feed, AEL cycle status, quick controls, chat with agent
- **Revenue** — Stripe revenue charts (daily/weekly/monthly), recent payments
- **Tools & Execution** — Tool performance stats, Docker sandbox status
- **Plans & Reflections** — Completed tasks, daily reflections, learning log
- **Settings & Control** — Agent controls, masked config view, channel status

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Cash-Claw                        │
│                                                   │
│  ┌─────────────────┐   ┌──────────────────────┐  │
│  │  HTTP Gateway    │   │  Autonomous Exec Loop │  │
│  │  (REST + WS)     │   │  (AEL)                │  │
│  │  Protocol v1     │   │                       │  │
│  │  127.0.0.1:18789 │   │  Plan → QueryLoop →   │  │
│  │  + Dashboard UI  │   │  Review → Reflect     │  │
│  └────────┬─────────┘   └──────────┬────────────┘  │
│           │                        │               │
│           └────────┬───────────────┘               │
│                    │                               │
│  ┌─────────────────▼──────────────────────────┐   │
│  │  39+ Tools · 8 Skills · Cost Tracker       │   │
│  │  ConfigBridge · Session · Learning System  │   │
│  │  Docker Sandbox · SandboxManager           │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
         │           │           │           │
    ┌────▼────┐ ┌────▼────┐ ┌───▼────┐ ┌────▼─────┐
    │Telegram │ │WhatsApp │ │ Stripe │ │  LLM     │
    │  Bot    │ │(Baileys)│ │Payment │ │  Router  │
    └─────────┘ └─────────┘ └────────┘ └──────────┘
```

### Autonomous Execution Loop (AEL)

The AEL runs in a continuous loop parallel to the chat runtime:

1. **Observe** — Gather context: goals, learnings, errors, operator messages
2. **Plan** — LLM creates a prioritized task queue based on `GOALS.md`
3. **Execute** — Multi-turn QueryLoop: LLM calls tools, reviews results, iterates
4. **Reflect** — Evaluate results, log learnings, update priorities

### Gateway Protocol v1

Cash-Claw uses a structured WebSocket protocol inspired by OpenClaw:

- **Mandatory handshake** — first frame must be `{ "type": "connect", "version": 1 }`
- **Request/Response** — `{ "type": "req", "id": "r1", "method": "state.get" }`
- **Server-push events** — `{ "type": "event", "event": "cycle_start", "ts": ... }`
- **Zod schema validation** on all incoming frames
- **Idempotency keys** for side-effecting operations
- **Optional auth token** via `CASHCLAW_GATEWAY_TOKEN`

---

## Monetization Categories

Cash-Claw organizes revenue streams into 4 groups:

### Content
- AI Books, Faceless YouTube, SEO Blogs, Social Media Agency

### Outreach
- Cold Email, Lead Generation, Freelance Platforms

### Finance
- Crypto/Stock Trading, Prediction Markets, Arbitrage

### Products
- Digital Products, Print-on-Demand, Micro-SaaS

---

## Tools (39 total)

| Category | Tools | Count |
|----------|-------|-------|
| Filesystem | read, write, list, exists, mkdir | 5 |
| Communication | telegram.send, telegram.getMe, telegram.polling, whatsapp.send | 4 |
| Google Workspace | gmail, calendar, sheets, drive, contacts, docs | 12 |
| Browser | open, interact, snapshot, search, parseDOM | 6 |
| Learning | log, list, summarize, tag, export | 5 |
| Stripe | createPaymentLink, listCustomers, webhookHandler | 3 |
| Scheduling | schedule, list, cancel | 3 |
| Agents | subagent.spawn, llm.send | 2 |
| Sandbox | execute_code (JS/Python/Bash in Docker) | 1 |

---

## LLM Support

| Provider | Models | Pricing (per 1M tokens) |
|----------|--------|------------------------|
| Anthropic | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | $1–$25 |
| OpenAI | GPT-5.4, GPT-5.4-mini, GPT-5.4-nano | $0.20–$15 |
| Google | Gemini 3.1 Pro, Gemini 3 Flash, 2.5 Pro/Flash | $0.15–$5 |
| Ollama | Any local model | Free |

Automatic fallback: if the primary model fails, Cash-Claw switches to a cheaper model.

---

## Security

- **Zero-trust** — HTTP Gateway binds to `127.0.0.1` (loopback only)
- **Auth token** — optional `CASHCLAW_GATEWAY_TOKEN` for REST + WebSocket
- **Secret redaction** — API keys and tokens automatically masked in all log output
- **Schema validation** — all tool inputs and protocol frames validated with Zod
- **Path hardening** — filesystem tools guard against symlink escapes
- **Budget enforcement** — daily and per-query cost limits prevent runaway spending
- **Docker sandbox** — untrusted tools run in isolated Docker containers (ReadonlyRootfs, no network, CapDrop ALL, memory/CPU limits)
- **Onboarding gate** — agent waits for sufficient operator briefing before autonomous work

See [SECURITY.md](SECURITY.md) for the full security policy.

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Watch mode (auto-rebuild)
npm run typecheck    # Type-check only
npm test             # Build + run 58 tests
npm run clean        # Remove dist/
```

### Project Structure

```
cash-claw/
├── src/
│   ├── cli/                 # CLI (Commander.js) + onboarding wizard
│   ├── config/              # Config types + persistence
│   ├── gateway/
│   │   ├── protocol/        # WebSocket Protocol v1 types + schemas
│   │   ├── AgentRuntime.ts  # Autonomous Execution Loop
│   │   ├── QueryLoop.ts     # Multi-turn LLM ↔ Tool loop
│   │   ├── HttpGateway.ts   # REST + WebSocket server
│   │   ├── LLMAdapter.ts    # LLM routing (4 providers)
│   │   ├── WhatsAppAdapter.ts  # WhatsApp via Baileys
│   │   ├── DockerSandbox.ts    # Docker container execution
│   │   ├── SandboxManager.ts   # Sandbox routing logic
│   │   ├── DashboardData.ts    # Dashboard data aggregation
│   │   ├── dashboard.ts        # Web dashboard UI (single-file HTML)
│   │   └── ...              # Telegram, Cost, Session, Learning, Skills
│   └── tools/               # 39+ tools in 9 categories
├── bootstrap/               # Agent identity files
├── .github/workflows/       # CI/CD (build, test, release)
├── package.json
├── tsconfig.json
└── LICENSE
```

---

## Roadmap

- [x] **Phase 1**: Source code + ConfigBridge
- [x] **Phase 2**: CLI & Onboarding wizard with debug mode
- [x] **Phase 3**: Autonomous Execution Loop (AEL)
- [x] **Phase 4**: Daily self-reflection
- [x] **Phase 5**: Monetization skills (Email, Content, Leads, etc.)
- [x] **Phase 6**: Testing & Hardening
- [x] **Phase 7**: WhatsApp adapter (Baileys)
- [x] **Phase 8**: Docker sandbox enforcement
- [x] **Phase 9**: Web dashboard UI

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT — see [LICENSE](LICENSE).

---

**Built on [OpenClaw](https://github.com/openclaw/openclaw)** — the open-source operating system for AI agents.
