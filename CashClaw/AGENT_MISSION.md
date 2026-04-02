# 🦞 CashClaw – Agent Mission: Phases 7–9

## Du bist ein KI-Coding-Agent (Claude Code)

Du arbeitest am Projekt **CashClaw** – einem autonomen AI Revenue Agent.
Deine Aufgabe: **Phasen 7, 8 und 9 vollständig implementieren.**

---

## Projekt-Kontext

- **Repo:** https://github.com/derprofi1313/cash-claw
- **Basis:** OpenClaw (https://github.com/openclaw/openclaw) – 345k Stars, etabliertes Framework
- **Language:** TypeScript (Node.js 22.16+ / 24)
- **Package Manager:** pnpm
- **Architektur:** Monorepo mit `src/gateway/`, `src/tools/`, `src/cli/`, `src/config/`

## Was bereits fertig ist (Phase 1–6)

- ✅ Autonomous Execution Loop (AEL): `src/gateway/AgentRuntime.ts`
- ✅ HTTP Gateway (REST + WebSocket): `src/gateway/HttpGateway.ts` + `GatewayServer.ts`
- ✅ Multi-LLM Adapter (Claude, GPT, Gemini, Ollama): `src/gateway/LLMAdapter.ts`
- ✅ Telegram Adapter: `src/gateway/TelegramAdapter.ts`
- ✅ 39 Tools in 9 Kategorien: `src/tools/`
- ✅ Stripe Integration: `src/tools/stripe/`
- ✅ CLI + Onboarding Wizard: `src/cli/`
- ✅ Web Dashboard (Grundstruktur): `src/gateway/dashboard.ts`
- ✅ AES-256-GCM Config-Verschlüsselung
- ✅ DailyReflection: `src/gateway/DailyReflection.ts`
- ✅ MonetizationSkills: `src/gateway/MonetizationSkills.ts`

---

## Deine Aufgaben: Phase 7 → 8 → 9

Lies die jeweilige Phase-Datei und erledige sie vollständig:

1. **`phase-07-whatsapp.md`** – WhatsApp Adapter
2. **`phase-08-docker.md`** – Docker Sandbox Enforcement
3. **`phase-09-dashboard.md`** – Web Dashboard UI (vollständig ausbauen)

---

## Arbeitsweise

1. **Zuerst lesen:** Lies alle drei Phase-Dateien komplett durch
2. **Clone das Repo:** `git clone https://github.com/derprofi1313/cash-claw.git`
3. **Install:** `pnpm install`
4. **Branch anlegen:** `git checkout -b feature/phase-7-8-9`
5. **Phase für Phase** abarbeiten – nach jeder Phase committen
6. **Tests schreiben** für alle neuen Features
7. **TypeScript kompiliert fehlerfrei:** `pnpm build`
8. **PR erstellen** wenn alle 3 Phasen fertig sind

## Qualitäts-Standards

- Kein `any` in TypeScript – strikte Typen
- Alle neuen Files haben JSDoc-Kommentare
- Error Handling mit aussagekräftigen Messages
- Security-first: keine Credentials in Logs, keine Hardcoded Secrets
- Konsistent mit dem bestehenden Code-Stil (ESLint/Prettier)

## Commit-Format

```
feat(phase-X): kurze Beschreibung

- Detail 1
- Detail 2

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

**Starte mit Phase 7. Viel Erfolg!** 🦞
