# Cash-Claw Agent Bootstrap-System

> Dieses Verzeichnis enthält alle Dateien, die der Agent beim Start liest,
> um seine Identität, Regeln, Tools und Fähigkeiten zu kennen.
> Die Dateien werden während `cashclaw onboard` automatisch generiert
> und mit den Daten des Users befüllt.

## Datei-Hierarchie

```
~/.cashclaw/
├── bootstrap/
│   ├── IDENTITY.md        ← Wer bin ich? Name, Persönlichkeit, Avatar
│   ├── SOUL.md            ← Wie verhalte ich mich? Tonalität, Regeln
│   ├── TOOLS.md           ← Was kann ich benutzen? Tool-Katalog
│   ├── GOALS.md           ← Was sind meine Ziele? (auto-generiert)
│   ├── OWNER.md           ← Wer ist mein Besitzer? Kontext, Präferenzen
│   ├── SERVICES.md        ← Welche Dienste biete ich an? Pricing
│   ├── RULES.md           ← Harte Grenzen, Verbote, Compliance
│   └── BOOTSTRAP.md       ← Einmalige Startup-Anweisungen
├── config.json            ← Technische Konfiguration (API Keys etc.)
├── tasks/                 ← Tages-Ergebnisse der AEL-Zyklen
└── memory/                ← Langzeitgedächtnis (kommt in Phase 4)
```

## Ladereihenfolge beim Gateway-Start

1. **config.json** → technische Verbindungen (LLM, Telegram, Stripe)
2. **IDENTITY.md** → Agent-Identität in System-Prompt
3. **SOUL.md** → Verhaltensregeln
4. **OWNER.md** → User-Kontext
5. **RULES.md** → Harte Sicherheitsregeln
6. **TOOLS.md** → Tool-Definitionen
7. **SERVICES.md** → Service-Katalog
8. **GOALS.md** → Aktuelle Ziele
9. **BOOTSTRAP.md** → Nur beim allerersten Start (dann markiert als erledigt)

Gesamtbudget: max 100.000 Zeichen im System-Prompt (konfigurierbar).

## Generierung

Alle Dateien werden beim Onboarding aus Templates + User-Eingaben generiert.
Der Agent kann seine eigenen Dateien lesen UND aktualisieren (z.B. GOALS.md
nach einem Reflexions-Zyklus anpassen).
