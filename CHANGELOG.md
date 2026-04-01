# Changelog

All notable changes to Cash-Claw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-04-01

### Added

- **Autonomous Execution Loop (AEL)** — continuous plan/execute/review/learn cycle
- **Multi-turn QueryLoop** — LLM ↔ Tool conversation with up to 10 turns per query
- **39 integrated tools** across 9 categories:
  - Filesystem (5), Communication (3), Google Workspace (12), Browser (6)
  - Learning (5), Stripe Payments (3), Cron Scheduling (3), Agents (2)
- **WebSocket Protocol v1** — structured req/res/event communication with Zod validation
- **Gateway Auth Token** — optional `CASHCLAW_GATEWAY_TOKEN` for HTTP + WS auth
- **Secret redaction** — API keys and tokens automatically masked in log output
- **8 monetization skills** — Email Outreach, Content, Leads, SEO, Landing Pages, Social Media, Competitor Analysis, Customer Support
- **Skill-aware planning** — AEL planner can create `skill:*` tasks that execute pre-built workflows
- **LLM routing** — Anthropic, OpenAI, Google Gemini, and Ollama support with automatic fallback
- **Cost tracking** — per-model and per-tool cost accounting with daily budget enforcement
- **Interactive onboarding** — 8-step CLI wizard with live API validation
- **Telegram operator control** — /status, /pause, /resume, /plan, /reflect, /stop
- **Daily reflection** — automated nightly analysis at 23:00 with learnings and goal updates
- **Session persistence** — conversation history and cost data survive restarts
- **OpenClaw skill discovery** — install and manage skills from OpenClaw/ClawHub
- **REST API** — health, state, costs, tools, skills, session, control endpoints
- **Robust tool call parsing** — fenced code blocks + balanced brace extraction
- **Operator onboarding gate** — agent waits for sufficient briefing before autonomous work
- **Hourly proactive wakeup** — agent checks progress and asks for new ideas every hour

### Security

- Loopback-only HTTP binding (127.0.0.1)
- Zod schema validation on all tool inputs and protocol frames
- Path hardening against symlink escapes
- Budget enforcement (daily + per-query limits)
- Optional bearer token authentication for Gateway

[0.1.0]: https://github.com/derprofi1313/cash-claw/releases/tag/v0.1.0
