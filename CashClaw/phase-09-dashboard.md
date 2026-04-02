# Phase 9: Web Dashboard UI (vollständig ausbauen)

## Ziel

Das Web-Dashboard (`src/gateway/dashboard.ts`) ist bereits als Grundstruktur vorhanden. Baue es zu einem vollständigen, produktionsreifen Monitoring- und Kontroll-Interface aus.

**Wichtig:** Das Dashboard ist nur auf `127.0.0.1` erreichbar (kein externer Zugriff) – bereits durch das bestehende HTTP-Gateway sichergestellt.

---

## Tech Stack (kein externes Frontend-Build-Tool nötig)

- **Single-file HTML** – wird direkt vom Express-Server geserved
- **Vanilla JS + Alpine.js** (via CDN) für Reaktivität
- **Chart.js** (via CDN) für Diagramme
- **Tailwind CSS** (via CDN) für Styling
- **WebSocket** für Live-Updates (bereits auf Port 18789 vorhanden)

Kein React, kein Vite, kein Webpack – bleibt einfach und wartbar.

---

## Dashboard-Seiten / Tabs

### Tab 1: 📊 Overview (Startseite)

**KPI-Cards (oben):**
- 💰 Revenue Today / This Week / This Month (aus Stripe)
- 🤖 Agent Status: RUNNING / PAUSED / IDLE
- 🔄 Tasks Completed Today
- 💸 LLM Cost Today (aus CostTracker)

**Live Activity Feed (rechte Seite):**
- Echtzeit-Log der Agent-Aktionen via WebSocket
- Colour-coded: INFO (blau), WARN (gelb), ERROR (rot), TOOL_CALL (grün)
- Auto-scroll mit Pause-Button

**AEL Cycle Visualizer:**
- Aktueller Zyklus-Status: Observe → Plan → Execute → Reflect
- Aktuelle Task-Beschreibung
- Letzte Completion-Zeit

---

### Tab 2: 💰 Revenue

**Stripe-Integration:**
- Tabelle aller Payments (Datum, Betrag, Beschreibung, Status)
- Balkendiagramm: Revenue der letzten 30 Tage
- Kategorien-Breakdown (Email, Content, Leads, Finance, Products)
- Monatliche Zusammenfassung

**Datenquelle:** `GET /api/revenue` (neuer Endpoint)

---

### Tab 3: 🔧 Tools & Execution

**Tool-Performance-Tabelle:**

| Tool Name | Calls Today | Avg Duration | Success Rate | Last Called |
|-----------|------------|--------------|--------------|-------------|
| send_telegram_message | 12 | 245ms | 100% | 2 min ago |
| ... | ... | ... | ... | ... |

**Sandbox-Status:**
- Docker verfügbar: ✓/✗
- Laufende Container: X
- Gesandboxte Calls heute: X

---

### Tab 4: 📝 Plans & Reflections

**Heutiger Plan:**
- Aktueller Agent-Plan (aus `AgentRuntime.currentPlan`)
- Fortschrittsbalken pro Sub-Task

**Reflections-History:**
- Letzte 7 DailyReflections (aus `DailyReflection`)
- Aufklappbar pro Tag

**Learning-Log:**
- Letzte 20 Einträge aus `LearningSystem`

---

### Tab 5: ⚙️ Settings & Control

**Agent Control:**
```
[▶ Resume] [⏸ Pause] [⏹ Stop] [🔄 Restart]
```

**Konfiguration anzeigen** (read-only, sensitive Werte maskiert):
- LLM Provider + Model
- Monetization-Kategorien: ein/aus
- Budget-Limits
- Work Hours

**Channel-Status:**
- Telegram: ✓ Connected / ✗ Disconnected
- WhatsApp: ✓ Connected / ✗ Disconnected / ○ Disabled
- Docker Sandbox: ✓ Available / ✗ Not installed

**Danger Zone:**
- "Clear all logs" Button (mit Bestätigung)

---

## Backend: Neue API-Endpoints in `HttpGateway.ts`

```typescript
// Neue Endpoints die du hinzufügen musst:

GET  /api/status          // Agent-Status, Channel-Status, Docker-Status
GET  /api/revenue         // Stripe Revenue-Daten (letzte 30 Tage)
GET  /api/logs?limit=100  // Letzte N Log-Einträge
GET  /api/tools/stats     // Tool-Performance-Statistiken
GET  /api/plans           // Aktueller Plan + History
GET  /api/reflections     // DailyReflections der letzten 7 Tage
POST /api/agent/pause     // Agent pausieren
POST /api/agent/resume    // Agent fortsetzen
POST /api/agent/stop      // Agent stoppen
GET  /api/config          // Config (sensitive Werte maskiert!)
```

**Response-Format (einheitlich):**
```typescript
interface ApiResponse<T> {
  success: boolean
  data: T
  timestamp: string
  error?: string
}
```

---

## WebSocket Live-Updates

Der bestehende WebSocket-Server soll folgende Events senden:

```typescript
// Events die der Server pusht:
{ type: 'log',        payload: LogEntry }
{ type: 'ael_cycle',  payload: { phase: 'observe'|'plan'|'execute'|'reflect', task: string } }
{ type: 'tool_call',  payload: { tool: string, duration: number, success: boolean } }
{ type: 'revenue',    payload: { amount: number, currency: string, description: string } }
{ type: 'status',     payload: { state: 'running'|'paused'|'idle' } }
```

---

## Datei-Struktur

```
src/gateway/
├── dashboard.ts          ← ERWEITERN (API-Handler + HTML-Generator)
├── DashboardData.ts      ← NEU: Aggregiert Daten für das Dashboard
└── WebSocketBroadcaster.ts ← NEU: Zentralisiert WS-Events
```

### `src/gateway/DashboardData.ts` (neu)

```typescript
export class DashboardData {
  constructor(
    private costTracker: CostTracker,
    private learningSystem: LearningSystem,
    private sessionManager: SessionManager,
    private stripeClient?: Stripe
  ) {}

  async getRevenueSummary(): Promise<RevenueSummary>
  async getToolStats(): Promise<ToolStats[]>
  async getAgentStatus(): Promise<AgentStatus>
  async getRecentLogs(limit: number): Promise<LogEntry[]>
}
```

---

## UI/UX Anforderungen

- **Dark Mode** als Default (passt zum "hacker tool" Feeling)
- **Responsive** (funktioniert auch auf 1280px wide)
- **Auto-Refresh:** Revenue + Status alle 30s automatisch refreshen
- **Favicon:** 🦞 Emoji als Favicon
- **Titel:** `CashClaw Dashboard`
- **Toast-Notifications** bei Agent-Control-Aktionen ("Agent paused ✓")

---

## HTML-Template Struktur

Das Dashboard wird als **single HTML string** in `dashboard.ts` generiert und via `res.send(html)` ausgeliefert.

Verwende Template Literals:

```typescript
export function generateDashboardHTML(config: DashboardConfig): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <title>CashClaw Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <!-- ... -->
</head>
<body class="bg-gray-950 text-gray-100">
  <!-- Tabs, Cards, Charts, Live Feed -->
</body>
</html>`
}
```

---

## Tests

Erstelle `src/gateway/dashboard.test.ts`:

- Unit-Test: Alle API-Endpoints antworten mit korrektem Format
- Unit-Test: Sensitive Config-Werte werden maskiert (`***`)
- Unit-Test: `DashboardData.getRevenueSummary()` bei fehlendem Stripe → leeres Array, kein Crash
- Integration-Test: WebSocket empfängt `status`-Event nach `POST /api/agent/pause`

---

## Definition of Done

- [ ] Dashboard erreichbar unter `http://127.0.0.1:18789/`
- [ ] Alle 5 Tabs funktionieren
- [ ] Live-Log via WebSocket
- [ ] Agent Pause/Resume/Stop via Dashboard
- [ ] Revenue-Chart zeigt echte Stripe-Daten (oder Mock wenn kein Stripe)
- [ ] Tool-Stats-Tabelle gefüllt
- [ ] Dark Mode
- [ ] `pnpm build` fehlerfrei
- [ ] Tests grün
- [ ] Screenshot des Dashboards in `docs/dashboard.png` speichern
