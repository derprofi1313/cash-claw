# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in Cash-Claw, please report it responsibly.

**Email:** security@cashclaw.dev (or open a private GitHub security advisory)

### Required Information

1. **Description** of the vulnerability
2. **Steps to reproduce**
3. **Impact assessment** (what can an attacker do?)
4. **Affected component** (gateway, tools, config, etc.)
5. **Suggested fix** (if you have one)

## Security Model

Cash-Claw follows a **single-operator trust model**, similar to [OpenClaw](https://github.com/openclaw/openclaw):

### Trust Boundaries

- **Gateway** binds to `127.0.0.1` (loopback only) — no remote access by default
- **Optional auth token** via `CASHCLAW_GATEWAY_TOKEN` environment variable
- **Operator = trusted** — the person running Cash-Claw controls all agent actions
- **LLM = untrusted** — the agent's output is validated before execution

### Tool Security

- All tool inputs are validated with **Zod schemas** before execution
- **Permission modes**: `autonomous`, `read_only`, `manual`, `default`
- **Path hardening**: filesystem tools use `realpathSync` against symlink escapes
- **Budget enforcement**: daily API cost limits and per-query budget caps
- **Action limits**: max actions per day prevents runaway execution

### WebSocket Protocol v1

- Mandatory handshake with version check
- Optional bearer token authentication
- JSON schema validation on all incoming frames
- Idempotency keys for side-effecting operations

### Configuration Security

- Config stored in `~/.cashclaw/config.json` — contains API keys in plaintext
- **Do NOT commit config.json** — it's in `.gitignore`
- Secret values are automatically redacted in log output
- API keys are validated against real APIs during onboarding

## Out of Scope

- Prompt injection without a tool/auth boundary bypass
- Issues requiring local filesystem access (already trusted operator boundary)
- Vulnerabilities in upstream dependencies (report to those projects)
- Exposing the gateway to public internet (explicitly not supported)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
