# Contributing to Cash-Claw

Thanks for your interest in contributing!

## Quick Start

```bash
git clone https://github.com/JannikGDev/cash-claw.git
cd cash-claw
npm install
npm run build
npm test
```

## Development Workflow

```bash
npm run dev          # Watch mode (auto-rebuild on changes)
npm run typecheck    # Type-check only (no output)
npm test             # Build + run all tests
npm run clean        # Remove dist/
```

## Project Structure

- `src/cli/` — CLI entry point and onboarding wizard
- `src/config/` — Configuration types and persistence
- `src/gateway/` — Core runtime: AEL, QueryLoop, LLM, Telegram, HTTP
- `src/gateway/protocol/` — WebSocket Protocol v1 types and schemas
- `src/tools/` — Tool system: registry, execution, all tool implementations
- `bootstrap/` — Agent identity and personality files

## How to Contribute

### Bug Reports

Open an issue with:
1. Steps to reproduce
2. Expected vs actual behavior
3. Node.js version and OS

### Feature Requests

Open an issue describing:
1. The problem you're trying to solve
2. Your proposed solution
3. Alternatives you've considered

### Pull Requests

1. Fork the repo and create a feature branch from `main`
2. Write your changes with TypeScript strict mode
3. Add tests for new functionality
4. Run `npm run typecheck && npm test` — everything must pass
5. Keep PRs focused — one feature/fix per PR
6. Write a clear PR description

### Code Style

- **TypeScript strict mode** — no `any` casts, proper error types
- **Zod validation** — all external input validated with Zod schemas
- **Tool pattern** — new tools use `buildTool()` with schema, permissions, and execution
- **No unnecessary abstractions** — keep it simple
- **Test critical paths** — tool parsing, protocol validation, cost calculation

### Commit Messages

Use conventional format:
```
feat: add WhatsApp adapter
fix: handle rate limit in LLM fallback
test: add parseToolCalls edge cases
docs: update README with new CLI commands
```

## Architecture Decisions

Cash-Claw extends [OpenClaw](https://github.com/openclaw/openclaw) with an Autonomous Execution Loop (AEL). Key design principles:

- **Cost-aware execution** — every LLM call and tool execution is tracked and budgeted
- **Operator-in-the-loop** — Telegram for control, onboarding gate before autonomous work
- **Learning from errors** — failures are logged and fed back into future planning
- **Protocol-first** — WebSocket Protocol v1 with schema validation for all communication

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
