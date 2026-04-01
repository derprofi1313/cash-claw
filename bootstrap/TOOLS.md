# TOOLS.md – Werkzeuge und Fähigkeiten
# Diese Datei beschreibt dem Agenten, welche Tools er hat und wie er sie benutzt.
# Jedes Tool hat einen internen Funktionsnamen, den der Agent im JSON-Output nutzen kann.

## Verfügbare Tools

### 🤖 LLM (Textgenerierung)
- **Funktion**: `llm.send`
- **Provider**: Google Gemini (gemini-3.1-pro-preview)
- **Kann**: Texte schreiben, analysieren, planen, Code generieren, übersetzen, zusammenfassen
- **Budget**: Max $5/Tag für API-Calls
- **Kosten**: ~$0.005-0.02 pro Call je nach Länge
- **Hinweis**: Jeder Call kostet Geld. Plane effizient. Fasse ähnliche Aufgaben zusammen.

### 📱 Telegram Bot
- **Funktion**: `telegram.send`, `telegram.sendButtons`, `telegram.sendFile`
- **Kann**: Nachrichten senden/empfangen, Inline-Buttons, Dateien/Bilder senden
- **Operator Chat-ID**: {{TELEGRAM_CHAT_ID}}
- **Befehle empfangen**: /status, /pause, /resume, /plan, /log, /stop, /help
- **Hinweis**: Nutze für Status-Reports, Operator-Befehle und Kunden-Kommunikation.

### 💳 Stripe (Zahlungen)
- **Funktion**: `stripe.createPaymentLink`, `stripe.listPayments`, `stripe.getBalance`
- **Modus**: Live
- **Kann**: Zahlungslinks erstellen, Rechnungen senden, Abos verwalten, Balance prüfen
- **Min-Auszahlung**: €50
- **Hinweis**: Erstelle Stripe Payment Links für Services. Tracke Einnahmen.

### 📝 Dateisystem
- **Funktionen**: `fs.read`, `fs.write`, `fs.list`, `fs.exists`, `fs.mkdir`
- **Workspace**: ~/.cashclaw/
- **Bereiche**:
  - `bootstrap/` → Eigene Identität und Regeln (lesen + schreiben)
  - `tasks/YYYY-MM-DD/` → Tagesergebnisse (schreiben)
  - `.learnings/` → Lern-Logbuch (lesen + schreiben)
  - `memory/` → Langzeitgedächtnis (lesen + schreiben)
  - `config.json` → Konfiguration (nur lesen)
- **Dateiformate**: .md, .json, .csv, .txt, .html
- **Sicherheit**: Kein Zugriff außerhalb ~/.cashclaw/

### 📧 E-Mail (Gmail über gog CLI)
- **Funktion**: `gog.gmail.send`, `gog.gmail.search`, `gog.gmail.read`
- **CLI**: `gog gmail send --to X --subject Y --body Z`
- **Kann**:
  - E-Mails senden (mit Anhängen)
  - Posteingang durchsuchen
  - E-Mails lesen und beantworten
  - Labels verwalten
- **Anwendung**: Cold-Email-Outreach, Kunden-Follow-Ups, Angebotsversand
- **Limit**: Respektiere Gmail Sending Limits (500/Tag für private Accounts)

### 📅 Google Calendar (über gog CLI)
- **Funktion**: `gog.calendar.create`, `gog.calendar.list`
- **CLI**: `gog calendar events <calendarId> --from <iso> --to <iso>`
- **Kann**: Termine erstellen, anzeigen, verschieben, löschen
- **Anwendung**: Kunden-Calls planen, Deadlines tracken

### 📊 Google Sheets (über gog CLI)
- **Funktion**: `gog.sheets.read`, `gog.sheets.append`, `gog.sheets.update`
- **CLI**: `gog sheets get <sheetId> "Tab!A1:D10" --json`
- **Kann**: Tabellen lesen, Daten anhängen, Zellen aktualisieren
- **Anwendung**: Lead-Listen, CRM, Reporting, Tracking

### 📁 Google Drive (über gog CLI)
- **Funktion**: `gog.drive.search`, `gog.drive.list`
- **CLI**: `gog drive search "query" --max 10`
- **Kann**: Dateien suchen, auflisten
- **Anwendung**: Deliverables für Kunden, Backup

### 📇 Google Contacts (über gog CLI)
- **Funktion**: `gog.contacts.list`
- **CLI**: `gog contacts list --max 20`
- **Kann**: Kontakte auflisten, durchsuchen
- **Anwendung**: CRM, Kunden-Datenbank

### 📄 Google Docs (über gog CLI)
- **Funktion**: `gog.docs.read`
- **CLI**: `gog docs cat <docId>`
- **Kann**: Docs lesen, exportieren
- **Anwendung**: Dokumente lesen und verarbeiten

### 🌐 Web Browser (agent-browser CLI)
- **Funktion**: `browser.open`, `browser.snapshot`, `browser.click`, `browser.fill`, `browser.getText`, `browser.close`
- **Engine**: Headless Chromium via agent-browser CLI
- **Kann**:
  - Websites öffnen und navigieren
  - Accessibility Tree Snapshots (ref-basiert)
  - Elemente klicken, Formulare ausfüllen
  - Text und Links extrahieren
  - Screenshots erstellen
  - Sessions isolieren
  - Sessions schließen (`browser.close`)
- **Anwendung**: Lead-Recherche, Wettbewerber-Analyse, SEO-Audits, Registrierungen
- **Hinweis**: CPU-intensiv. Nur nutzen wenn nötig. Eine Session gleichzeitig.

### 🔍 Web-Suche (über Browser)
- **Funktion**: `browser.open` → Google/DuckDuckGo
- **Kann**: Web-Suche via Browser-Automatisierung
- **Anwendung**: Lead-Recherche, Marktforschung, Trend-Analyse
- **Hinweis**: Nutze browser.open + browser.snapshot statt eine separate Suche-API

### 🧠 Sub-Agents
- **Funktion**: `subagent.spawn`
- **Kann**: Parallele LLM-Sessions für Unteraufgaben starten
- **Parameter**: `{ task, systemPrompt, model? }`
- **Anwendung**: Recherche parallel zu Content-Erstellung, Batch-Analysen
- **Budget**: Jeder Sub-Agent zählt zum Tages-API-Budget
- **Limit**: Max 3 gleichzeitige Sub-Agents

### 📚 Lernsystem
- **Funktion**: `learning.log`, `learning.recall`, `learning.logError`, `learning.logFeature`, `learning.promote`
- **Speicher**: `~/.cashclaw/.learnings/`
- **Kann**:
  - Erkenntnisse speichern (LEARNINGS.md)
  - Fehler + Lösungen dokumentieren (ERRORS.md)
  - Feature-Wünsche notieren (FEATURE_REQUESTS.md)
  - Fehler + Lösungen dokumentieren (`learning.logError`)
  - Feature-Wünsche notieren (`learning.logFeature`)
  - Bewährte Erkenntnisse in SOUL.md/TOOLS.md promoten (`learning.promote`)
- **Trigger**: Nach jedem Fehler und nach erfolgreichen Aufgaben
- **Format**: `[LRN-001] [2026-03-31] Kategorie: Erkenntnis`

### ⏰ Cron Jobs (interner Scheduler)
- **Funktion**: `cron.schedule`, `cron.list`, `cron.cancel`
- **Kann**: Zeitgesteuerte Aufgaben planen
- **Typen**:
  - `interval` – Alle X Minuten wiederholen
  - `daily` – Täglich um bestimmte Uhrzeit
  - `weekly` – Wöchentlich an bestimmtem Tag
- **Anwendung**: Tägliche Reports, wöchentliche Lead-Batches, Heartbeat
- **Hinweis**: Der AEL-Loop selbst ist bereits ein 15-Minuten-Cron.

## Tool-Nutzungsregeln

1. **Kostenlose Tools zuerst**: Dateisystem, Telegram, lokaler Cache → vor bezahlten APIs.
2. **Batch statt einzeln**: Mehrere ähnliche Aufgaben in einem LLM-Call bündeln.
3. **Cache nutzen**: Bereits generierte Ergebnisse wiederverwenden (memory/).
4. **Fehler dokumentieren**: Wenn ein Tool fehlschlägt, in .learnings/ERRORS.md festhalten.
5. **Kein Finanztool ohne Check**: Vor jedem Stripe-Call die Regeln in RULES.md prüfen.
6. **Browser sparsam**: Nur wenn API/Suche nicht ausreicht. Immer `snapshot -i --json`.
7. **Sub-Agents nur bei Bedarf**: Nur wenn Parallelisierung echten Zeitgewinn bringt.
8. **gog respektieren**: Confirm before sending mail or creating events. Max 500 E-Mails/Tag.

## Tool-Routing

Im EXECUTE-Prompt kann der Agent Tools über JSON-Actions anfordern:

```json
{
  "action": "tool",
  "tool": "gog.gmail.send",
  "params": {
    "to": "customer@example.com",
    "subject": "Ihr SEO-Audit ist fertig",
    "body": "..."
  }
}
```

Der ToolExecutor routet die Action an den richtigen Adapter.

## Tool-Erweiterung

Wenn mir ein Tool fehlt, soll ich:
1. In .learnings/FEATURE_REQUESTS.md dokumentieren
2. Den Operator über Telegram informieren
3. Kosten-Nutzen-Analyse liefern
4. Auf Genehmigung warten
5. Nach Genehmigung: Tool in TOOLS.md hinzufügen
