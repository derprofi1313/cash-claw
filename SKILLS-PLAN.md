# Cash-Claw Skills Plan
# Welche ClawHub-Skills werden integriert und wie

## Übersicht

Cash-Claw integriert ausgewählte ClawHub-Skills, um dem Agenten echte Fähigkeiten zu geben.
Statt nur Text zu generieren, kann Prisma jetzt E-Mails senden, Websites scrapen,
aus Fehlern lernen und Sub-Agents für parallele Aufgaben spawnen.

---

## 1. Google Workspace CLI – gog (Kern-Integration)

- **Skill**: [Gog by @steipete](https://clawhub.ai/steipete/gog)
- **Version**: v1.0.0 | ⭐ 796 | 3.2k Downloads
- **Lizenz**: MIT-0
- **Was es kann**: CLI für Gmail, Calendar, Drive, Contacts, Sheets, Docs – lokal via OAuth
- **Wie wir es nutzen**:
  - `GogAdapter` Klasse in `src/gateway/GogAdapter.ts`
  - CLI-Wrapper via `child_process.execFile`
  - Lokale OAuth-Authentifizierung (kein externer API-Gateway nötig)
  - `GOG_ACCOUNT` Environment-Variable für automatischen Account

### Genutzte Services über gog:

| Service | gog Befehl | Tool-Name | Verwendung |
|---------|-----------|-----------|------------|
| Gmail | `gog gmail send/search` | `gog.gmail.send/search/read` | E-Mail Outreach, Kunden-Kommunikation |
| Calendar | `gog calendar events` | `gog.calendar.list/create` | Termine mit Kunden, Deadlines |
| Sheets | `gog sheets get/append` | `gog.sheets.read/append/update` | Lead-Listen, Reporting |
| Drive | `gog drive search` | `gog.drive.search/list` | Deliverables speichern |
| Contacts | `gog contacts list` | `gog.contacts.list` | CRM, Kunden-Datenbank |
| Docs | `gog docs cat` | `gog.docs.read` | Dokumente lesen |

### Setup:
1. gog CLI installieren: `https://github.com/steipete/gogcli/releases` (Windows: .exe)
2. Google Cloud Console → OAuth 2.0 Client-ID (Desktop-App) erstellen
3. `gog auth credentials <pfad/zu/client_secret.json>`
4. `gog auth add user@gmail.com --services gmail,calendar,drive,contacts,sheets,docs`
5. `gog auth list` → Prüfe ob Account aktiv ist

---

## 2. Agent Browser (Web-Automatisierung)

- **Skill**: [Agent Browser by @matrixy](https://clawhub.ai/matrixy/agent-browser-clawdbot)
- **Version**: v0.1.0 | ⭐ 206 | 60.2k Downloads
- **Lizenz**: MIT-0
- **Was es kann**: Headless Chrome Automation via CLI, Accessibility Tree Snapshots
- **Wie wir es nutzen**:
  - `BrowserAdapter` Klasse in `src/gateway/BrowserAdapter.ts`
  - CLI: `agent-browser open <url>`, `agent-browser snapshot -i --json`
  - Ref-basierte Interaktion: `agent-browser click @e2`, `agent-browser fill @e3 "text"`
  - Session-Isolation: `agent-browser --session <name> open <url>`
  - State Persistence: `agent-browser state save auth.json`

### Anwendungsfälle:
- Lead-Recherche auf Websites (Kontaktdaten, Preise)
- Wettbewerber-Websites analysieren
- Formulare ausfüllen für Registrierungen
- Screenshots für SEO-Audits

### Setup:
```bash
npm install -g agent-browser
agent-browser install  # Chromium herunterladen
```

---

## 3. Self-Improving Agent (Lernsystem)

- **Skill**: [Self-Improving Agent by @pskoett](https://clawhub.ai/pskoett/self-improving-agent)
- **Version**: v3.0.10 | ⭐ 2,900 | 336k Downloads
- **Lizenz**: MIT
- **Was es kann**: Strukturiertes Lernen aus Fehlern und Erfolgen
- **Wie wir es nutzen**:
  - `LearningSystem` Klasse in `src/gateway/LearningSystem.ts`
  - `.learnings/` Verzeichnis mit LEARNINGS.md, ERRORS.md, FEATURE_REQUESTS.md
  - Einträge im Format: `[LRN-001] [2026-03-31] Kategorie: Erkenntnis`
  - Automatische Promotion: Nach 3+ bestätigten Learnings → in SOUL.md/TOOLS.md einfügen
  - Fehler-Tracking: Fehler + Lösung speichern, beim nächsten Mal vermeiden

### Struktur:
```
~/.cashclaw/.learnings/
├── LEARNINGS.md      # Bestätigte Erkenntnisse
├── ERRORS.md         # Fehler + Lösungen
└── FEATURE_REQUESTS.md  # Was der Agent gerne können würde
```

---

## 4. Proactive Agent (Konzepte übernommen)

- **Skill**: [Proactive Agent by @halthelobster](https://clawhub.ai/halthelobster/proactive-agent)
- **Version**: v3.1.0 | ⭐ 658
- **Lizenz**: MIT-0
- **Übernommene Konzepte** (nicht als ganzes Skill, sondern Ideen):
  - **WAL Protocol**: Write-Ahead Logging für crash-sichere Task-Execution
  - **Heartbeat System**: Periodische Selbstprüfung des Agent-Zustands
  - **Anti-Drift Limits**: ADL verhindert, dass der Agent zu weit abdriftet
  - **VFM Scoring**: Value-for-Money Bewertung jeder Aktion

---

## 5. Weitere relevante Skills (für spätere Phasen)

| Skill | Link | Verwendung |
|-------|------|------------|
| Cold Email Writer | [clawhub.ai/1kalin/cold-email-writer](https://clawhub.ai/1kalin/cold-email-writer) | Templates für Cold Emails |
| Email Best Practices | [clawhub.ai/christina-de-martinez/email-best-practices](https://clawhub.ai/christina-de-martinez/email-best-practices) | SPF/DKIM/DMARC Setup |
| Multi Search Engine | [clawhub.ai/skills](https://clawhub.ai/skills) | Mehrere Suchmaschinen parallel |
| Humanizer | [clawhub.ai/skills](https://clawhub.ai/skills) | AI-Text menschlicher klingen lassen |
| Nano PDF | [clawhub.ai/skills](https://clawhub.ai/skills) | PDF erstellen für Reports/Deliverables |
| Ontology | [clawhub.ai/skills](https://clawhub.ai/skills) | Wissensstrukturierung |

---

## Architektur-Übersicht

```
GatewayServer
├── LLMAdapter         (Text-Generierung)
├── TelegramAdapter    (Operator-Kommunikation)
├── GogAdapter         (Google Workspace CLI)      ← NEU (ersetzt Maton)
├── BrowserAdapter     (Web-Automatisierung)       ← NEU
├── LearningSystem     (Selbstverbesserung)        ← NEU
├── SubAgentManager    (Parallele Tasks)           ← NEU
├── BootstrapManager   (Identity Files)            ← NEU
├── ToolExecutor       (Tool-Routing + Cron)       ← NEU
├── CronScheduler      (Zeitgesteuerte Aufgaben)   ← NEU
├── DailyReflection    (Nächtliche Selbstreflexion) ← NEU
└── AgentRuntime       (AEL Loop)
```

## Implementierungsreihenfolge

1. ✅ Skills Plan erstellen (diese Datei)
2. ✅ Bootstrap-Dateien aktualisieren (TOOLS.md, IDENTITY.md etc.)
3. ✅ `ToolExecutor` — Zentraler Tool-Router für den Agenten
4. ✅ `GogAdapter` — Google Workspace CLI Wrapper (ersetzt Maton)
5. ✅ `BrowserAdapter` — agent-browser CLI Wrapper
6. ✅ `LearningSystem` — .learnings/ Management
7. ✅ `SubAgentManager` — Parallele LLM-Sessions
8. ✅ `BootstrapManager` — Bootstrap-Files lesen/injizieren
9. ✅ AgentRuntime + GatewayServer aktualisieren
10. ✅ Onboarding Wizard erweitern (gog Setup)
11. ✅ Cron-System im ToolExecutor
12. ⬜ Phase 4: DailyReflection (Nächtliche Selbstreflexion)
13. ⬜ Phase 5: Monetarisierungs-Skill-Workflows
