# Phase 7: WhatsApp Adapter

## Ziel

Implementiere einen vollständigen WhatsApp-Adapter für CashClaw, der es dem Operator ermöglicht, den autonomen Agent über WhatsApp zu steuern – analog zum bestehenden Telegram-Adapter (`src/gateway/TelegramAdapter.ts`).

---

## Technologie

Verwende **Baileys** (`@whiskeysockets/baileys`) – dasselbe Package das OpenClaw nutzt.

```bash
pnpm add @whiskeysockets/baileys qrcode-terminal
pnpm add -D @types/qrcode-terminal
```

---

## Zu erstellende Dateien

### 1. `src/gateway/WhatsAppAdapter.ts` (Haupt-Adapter)

```typescript
// Pflichtfelder der Klasse WhatsAppAdapter:
export class WhatsAppAdapter {
  constructor(private config: WhatsAppConfig, private runtime: AgentRuntime) {}

  async start(): Promise<void>      // Verbindung aufbauen, QR-Code anzeigen
  async stop(): Promise<void>       // Sauber disconnecten
  async sendMessage(to: string, text: string): Promise<void>
  async sendTyping(to: string): Promise<void>
  private handleIncoming(msg: WAMessage): Promise<void>
  private isOperator(jid: string): boolean
}
```

**Anforderungen:**

- **QR-Code Login:** Beim ersten Start QR-Code im Terminal anzeigen (via `qrcode-terminal`). Nach erfolgreichem Scan: Session persistieren in `~/.cashclaw/whatsapp-session/`
- **Session Persistenz:** `useSingleFileAuthState` oder `useMultiFileAuthState` von Baileys nutzen – Session bleibt nach Neustart bestehen
- **Operator-Whitelist:** Nur Nachrichten von der konfigurierten `operatorNumber` (E.164-Format, z.B. `+4917612345678`) werden verarbeitet
- **Reconnect-Logik:** Automatisch reconnecten bei Verbindungsabbruch (max. 5 Versuche mit exponential backoff)
- **Message-Handling:** Eingehende Text-Nachrichten vom Operator an `AgentRuntime.handleOperatorCommand()` weiterleiten
- **Media ignorieren:** Voice-Memos, Bilder etc. mit einer freundlichen Antwort ablehnen: `"Ich verstehe nur Text-Befehle. Tippe /help für Hilfe."`

### 2. `src/tools/whatsapp/` (Tool-Verzeichnis)

Erstelle `src/tools/whatsapp/SendWhatsAppMessage.ts`:

```typescript
export class SendWhatsAppMessageTool extends Tool {
  name = 'send_whatsapp_message'
  description = 'Sends a WhatsApp message to the operator'

  async execute(params: { message: string }): Promise<ToolResult>
}
```

### 3. `src/config/types.ts` – Erweiterung

Füge zu `CashClawConfig` hinzu:

```typescript
whatsapp?: {
  enabled: boolean
  operatorNumber: string    // E.164 Format: +491234567890
  sessionPath: string       // Default: ~/.cashclaw/whatsapp-session
  reconnectAttempts: number // Default: 5
}
```

### 4. `src/cli/onboarding.ts` – Erweiterung

Füge WhatsApp als optionalen Kanal zum Onboarding-Wizard hinzu (Step nach Telegram):

```
? Enable WhatsApp operator channel? (y/N)
? Your WhatsApp number (E.164 format, e.g. +491234567890):
```

---

## Unterstützte Operator-Befehle (identisch mit Telegram)

| Befehl | Beschreibung |
|--------|-------------|
| `/status` | Aktuellen Agent-Status anzeigen |
| `/pause` | AEL pausieren |
| `/resume` | AEL fortsetzen |
| `/plan` | Nächsten Plan ausgeben |
| `/reflect` | Tages-Reflexion auslösen |
| `/log` | Letzte 10 Log-Einträge |
| `/stop` | Agent stoppen |
| `/help` | Befehlsliste |

---

## Integration in GatewayServer.ts

```typescript
// In GatewayServer.start():
if (this.config.whatsapp?.enabled) {
  this.whatsappAdapter = new WhatsAppAdapter(this.config.whatsapp, this.runtime)
  await this.whatsappAdapter.start()
  logger.info('WhatsApp adapter started')
}
```

---

## Tests

Erstelle `src/gateway/WhatsAppAdapter.test.ts`:

- Unit-Test: `isOperator()` gibt true für whitelisted JID zurück
- Unit-Test: Unbekannte JIDs werden abgelehnt
- Unit-Test: `/help` Command wird korrekt gerouted
- Mock Baileys WebSocket-Verbindung

---

## Definition of Done

- [ ] WhatsApp-Session überlebt Neustart
- [ ] QR-Code erscheint beim ersten Start im Terminal
- [ ] Alle 8 Operator-Befehle funktionieren
- [ ] Unbekannte Absender bekommen eine Ablehnung
- [ ] `pnpm build` läuft fehlerfrei durch
- [ ] Tests grün
- [ ] `README.md` aktualisiert: WhatsApp-Sektion hinzugefügt
