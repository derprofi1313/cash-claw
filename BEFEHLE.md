# Cash-Claw CLI – Befehle

**Version:** 0.1.0

---

## Übersicht

```
cashclaw [options] [command]
```

| Option | Beschreibung |
|--------|-------------|
| `-V, --version` | Versionsnummer anzeigen |
| `-h, --help` | Hilfe anzeigen |

---

## Befehle

### `cashclaw onboard`

Interaktiver Setup-Wizard (8 Schritte).

```bash
cashclaw onboard          # Normal starten
cashclaw onboard --debug  # Mit Live-Debug-Ausgabe
```

| Option | Beschreibung |
|--------|-------------|
| `--debug` | Debug-Modus: Zeigt live Config- und API-Events |

---

### `cashclaw gateway`

Cash-Claw Gateway starten (AEL + Telegram + LLM + HTTP-API).

```bash
cashclaw gateway              # Standardport 3847
cashclaw gateway --port 8080  # Eigener Port
cashclaw gateway --debug      # Debug-Modus
```

| Option | Beschreibung |
|--------|-------------|
| `--port <port>` | Server Port (Standard: `3847`) |
| `--debug` | Live Agent-Gedanken, Pläne und API-Calls anzeigen |

**HTTP-Endpunkte** (auf `http://127.0.0.1:<port>`):

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/` | **Web-Dashboard** (Live-Ansicht mit WebSocket) |
| GET | `/health` | Healthcheck (Status + Uptime) |
| GET | `/api/state` | Aktueller Agent-Status |
| GET | `/api/costs` | Kostenübersicht (Session + Tagesbudget) |
| GET | `/api/tools` | Alle registrierten Tools (39x) |
| GET | `/api/skills` | Monetarisierungs-Skills (8x) |
| GET | `/api/session` | Aktuelle Session-Info |
| POST | `/api/control` | Steuerung: `{"action": "pause\|resume\|cycle\|stop\|reflect"}` |
| POST | `/api/chat` | Chat mit Agent: `{"message": "..."}` |
| GET | `/api/export/costs?format=json\|csv` | Kosten exportieren |
| GET | `/api/export/tasks?format=json\|csv` | Tasks exportieren |
| POST | `/webhook/stripe` | Stripe Webhook (Signatur-Verifizierung) |
| WS | `/ws` | WebSocket für Echtzeit-Events |

---

### `cashclaw status`

Zeigt den aktuellen Systemstatus aus `~/.cashclaw/config.json`.

```bash
cashclaw status
```

---

### `cashclaw debug-console`

Standalone Debug-Konsole (empfängt Events via stdin).

```bash
cashclaw debug-console
```

---

### `cashclaw encrypt`

Config mit AES-256-GCM verschlüsseln.

```bash
cashclaw encrypt --password "mein-passwort"
```

Danach Gateway starten mit:
```bash
CASHCLAW_CONFIG_PASSWORD="mein-passwort" cashclaw gateway
```

---

### `cashclaw decrypt`

Verschlüsselte Config entschlüsseln.

```bash
cashclaw decrypt --password "mein-passwort"
```

---

## Telegram-Befehle

Wenn Telegram konfiguriert ist, reagiert der Bot auf:

| Befehl | Beschreibung |
|--------|-------------|
| `/status` | Aktueller Agent-Status |
| `/pause` | Agent pausieren |
| `/resume` | Agent fortsetzen |
| `/plan` | Sofort einen Planungszyklus starten |
| `/reflect` | Sofort Tagesreflexion auslösen |
| `/log` | Letzte 5 Tasks anzeigen |
| `/stop` | Gateway herunterfahren |
| `/help` | Befehlsübersicht |

---

## npm-Scripts

```bash
npm run build      # TypeScript kompilieren
npm run dev        # TypeScript im Watch-Modus
npm run typecheck  # Nur Typ-Check (ohne Output)
npm test           # Build + Tests ausführen
npm run clean      # dist/ löschen
npm start          # Gateway starten (= node dist/cli/index.js)
```
