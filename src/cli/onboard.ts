// Cash-Claw Onboarding Wizard
// Interactive step-by-step terminal setup (like `npm init`)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  intro,
  outro,
  text,
  select,
  confirm,
  multiselect,
  isCancel,
  cancel,
  spinner,
  note,
} from "@clack/prompts";
import { ConfigBridge } from "../config/ConfigBridge.js";
import { DebugConsole } from "./DebugConsole.js";
import type { CashClawConfig } from "../config/types.js";
import { DEFAULT_STANDARD_SKILLS, OpenClawAdapter } from "../gateway/OpenClawAdapter.js";

function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup abgebrochen.");
    process.exit(0);
  }
  return value;
}

export async function runOnboardWizard(debugMode: boolean): Promise<void> {
  const bridge = new ConfigBridge();
  const debug = new DebugConsole(debugMode);

  // Attach debug listener
  debug.attach(bridge);
  if (debugMode) {
    debug.printHeader();
  }

  // Load or create config
  bridge.load();

  intro("🦀 Cash-Claw Setup Wizard");

  note(
    [
      "Willkommen bei Cash-Claw!",
      "Dieser Wizard richtet deinen autonomen KI-Agent ein.",
      "Jede Eingabe wird sofort validiert und gespeichert.",
      "",
      debugMode ? "🔍 Debug-Modus aktiv – alle Events werden live angezeigt." : "",
      "Abbruch jederzeit mit Ctrl+C.",
    ]
      .filter(Boolean)
      .join("\n"),
    "Cash-Claw v0.1.0"
  );

  // ============================================
  // STEP 1/8: LLM Configuration
  // ============================================
  const llmProvider = guardCancel(
    await select({
      message: "[1/8] Welchen LLM-Anbieter möchtest du verwenden?",
      options: [
        { value: "anthropic", label: "Anthropic (Claude)", hint: "Empfohlen" },
        { value: "openai", label: "OpenAI (GPT)" },
        { value: "google", label: "Google (Gemini)" },
        { value: "ollama", label: "Lokales Modell (Ollama)", hint: "Kein API-Key nötig" },
      ],
    })
  ) as CashClawConfig["llm"]["provider"];

  bridge.set("llm.provider", llmProvider);

  let llmApiKey = "";
  if (llmProvider !== "ollama") {
    llmApiKey = guardCancel(
      await text({
        message: `API Key für ${llmProvider}:`,
        placeholder: llmProvider === "anthropic" ? "sk-ant-..." : "sk-...",
        validate: (val) => (val.length < 10 ? "Key scheint zu kurz" : undefined),
      })
    ) as string;

    // Live-Validierung
    const s = spinner();
    s.start(`Teste ${llmProvider} API Key...`);

    let validation: { valid: boolean; error?: string };
    if (llmProvider === "anthropic") {
      validation = await bridge.validateAnthropicKey(llmApiKey);
    } else if (llmProvider === "openai") {
      validation = await bridge.validateOpenAIKey(llmApiKey);
    } else {
      // Google – skip live validation for now
      validation = { valid: true };
    }

    if (validation.valid) {
      s.stop(`✅ ${llmProvider} Key gültig!`);
    } else {
      s.stop(`⚠️ Key-Validierung fehlgeschlagen: ${validation.error}`);
      note("Du kannst den Key später in ~/.cashclaw/config.json korrigieren.", "Hinweis");
    }

    bridge.set("llm.apiKey", llmApiKey);
  }

  const modelName = guardCancel(
    await select({
      message: "Modell auswählen:",
      options: llmProvider === "anthropic"
        ? [
            { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "Stärkstes Modell – Agenten & Coding ($5/$25 MTok)" },
            { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "Schnell + intelligent ($3/$15 MTok)" },
            { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Am schnellsten, günstig ($1/$5 MTok)" },
          ]
        : llmProvider === "openai"
        ? [
            { value: "gpt-5.4", label: "GPT-5.4", hint: "Flagship – Agenten, Coding, Reasoning ($2.50/$15 MTok)" },
            { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", hint: "Stark für Coding & Sub-Agents ($0.75/$4.50 MTok)" },
            { value: "gpt-5.4-nano", label: "GPT-5.4 Nano", hint: "Am günstigsten für Massenaufgaben ($0.20/$1.25 MTok)" },
          ]
        : llmProvider === "google"
        ? [
            { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", hint: "Top-Modell – Agenten & Coding (Preview)" },
            { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", hint: "Frontier-Klasse, günstiger (Preview)" },
            { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Stable – Deep Reasoning & Coding" },
            { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Stable – Schnell & günstig" },
          ]
        : [
            { value: "llama3.3:70b", label: "Llama 3.3 70B", hint: "Meta – bestes lokales Modell" },
            { value: "qwen3:32b", label: "Qwen 3 32B", hint: "Alibaba – stark für Coding" },
            { value: "mistral-large", label: "Mistral Large", hint: "Mistral – multilingual" },
          ],
    })
  ) as string;

  bridge.set("llm.model", modelName);

  // ============================================
  // STEP 2/8: Chat Platform
  // ============================================
  const platformType = guardCancel(
    await select({
      message: "[2/8] Welche Chat-Plattform als Haupt-Interface?",
      options: [
        { value: "telegram", label: "Telegram (via grammY)", hint: "Empfohlen" },
        { value: "whatsapp", label: "WhatsApp (via Baileys)" },
        { value: "both", label: "Beide" },
      ],
    })
  ) as CashClawConfig["platform"]["type"];

  bridge.set("platform.type", platformType);

  if (platformType === "telegram" || platformType === "both") {
    const telegramToken = guardCancel(
      await text({
        message: "Telegram Bot Token:",
        placeholder: "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ",
        validate: (val) => {
          if (!val.includes(":")) return "Ungültiges Format (muss : enthalten)";
          return undefined;
        },
      })
    ) as string;

    const s = spinner();
    s.start("Teste Telegram Bot Token...");
    const result = await bridge.validateTelegramToken(telegramToken);

    if (result.valid) {
      s.stop(`✅ Bot gefunden: @${result.botName}`);
      bridge.set("platform.telegram", { botToken: telegramToken, operatorChatId: "" });
    } else {
      s.stop(`⚠️ Token ungültig: ${result.error}`);
      bridge.set("platform.telegram", { botToken: telegramToken, operatorChatId: "" });
      note("Du kannst den Token später korrigieren.", "Hinweis");
    }

    const operatorId = guardCancel(
      await text({
        message: "Deine Telegram Chat-ID (für Status-Reports):",
        placeholder: "123456789",
        validate: (val) => (/^\d+$/.test(val) ? undefined : "Muss eine Zahl sein"),
      })
    ) as string;

    bridge.set("platform.telegram.operatorChatId", operatorId);
  }

  if (platformType === "whatsapp" || platformType === "both") {
    const waNumber = guardCancel(
      await text({
        message: "Deine WhatsApp-Nummer (mit Ländervorwahl):",
        placeholder: "+491234567890",
        validate: (val) => (val.startsWith("+") ? undefined : "Muss mit + beginnen"),
      })
    ) as string;

    bridge.set("platform.whatsapp", { operatorNumber: waNumber });
  }

  // ============================================
  // STEP 3/8: Stripe Integration
  // ============================================
  const stripeKey = guardCancel(
    await text({
      message: "[3/8] Stripe Secret Key:",
      placeholder: "sk_live_...",
      validate: (val) => (val.startsWith("sk_") ? undefined : "Muss mit sk_ beginnen"),
    })
  ) as string;

  {
    const s = spinner();
    s.start("Teste Stripe Key...");
    const result = await bridge.validateStripeKey(stripeKey);
    if (result.valid) {
      s.stop("✅ Stripe verbunden!");
    } else {
      s.stop(`⚠️ Stripe Key ungültig: ${result.error}`);
      note("Du kannst den Key später korrigieren.", "Hinweis");
    }
  }

  bridge.set("stripe.secretKey", stripeKey);

  const stripeWebhook = guardCancel(
    await text({
      message: "Stripe Webhook Secret:",
      placeholder: "whsec_...",
      defaultValue: "",
    })
  ) as string;

  if (stripeWebhook) {
    bridge.set("stripe.webhookSecret", stripeWebhook);
  }

  const minPayout = guardCancel(
    await text({
      message: "Mindestbetrag für Auszahlung (EUR):",
      placeholder: "50",
      defaultValue: "50",
      validate: (val) => (isNaN(Number(val)) ? "Muss eine Zahl sein" : undefined),
    })
  ) as string;

  bridge.set("stripe.minPayout", Number(minPayout));

  // ============================================
  // STEP 4/8: Allowed Categories
  // ============================================
  const selectedCategories = guardCancel(
    await multiselect({
      message: "[4/8] Welche Einkommenskategorien darf der Agent nutzen?",
      options: [
        { value: "content",  label: "Content",  hint: "Bücher, YouTube, Blogs, Social Media" },
        { value: "outreach", label: "Outreach", hint: "Cold-Email, Lead-Gen, Freelance" },
        { value: "finance",  label: "Finance",  hint: "Trading, Krypto, Prediction Markets" },
        { value: "products", label: "Products", hint: "Digitale Produkte, PoD, SaaS" },
      ],
      required: true,
    })
  ) as string[];

  bridge.set("categories.content", selectedCategories.includes("content"));
  bridge.set("categories.outreach", selectedCategories.includes("outreach"));
  bridge.set("categories.finance", selectedCategories.includes("finance"));
  bridge.set("categories.products", selectedCategories.includes("products"));

  // ============================================
  // STEP 5/8: Financial Safety (only if finance selected)
  // ============================================
  if (selectedCategories.includes("finance")) {
    const maxRisk = guardCancel(
      await text({
        message: "[5/8] Maximales Tagesrisiko Trading (% des Portfolios):",
        placeholder: "2",
        defaultValue: "2",
        validate: (val) => (isNaN(Number(val)) ? "Muss eine Zahl sein" : undefined),
      })
    ) as string;
    bridge.set("financeLimits.maxDailyRiskPercent", Number(maxRisk));

    const minEdge = guardCancel(
      await text({
        message: "Mindest-Edge für Wetten (%):",
        placeholder: "5",
        defaultValue: "5",
        validate: (val) => (isNaN(Number(val)) ? "Muss eine Zahl sein" : undefined),
      })
    ) as string;
    bridge.set("financeLimits.minBetEdgePercent", Number(minEdge));

    const apiBudget = guardCancel(
      await text({
        message: "Tagesbudget für API-Kosten (USD):",
        placeholder: "5",
        defaultValue: "5",
        validate: (val) => (isNaN(Number(val)) ? "Muss eine Zahl sein" : undefined),
      })
    ) as string;
    bridge.set("financeLimits.dailyApiBudgetUsd", Number(apiBudget));
  } else {
    note("Finance nicht gewählt – Schritt 5 übersprungen.", "Info");
  }

  // ============================================
  // STEP 6/9: Schedule & Limits
  // ============================================
  const activeFrom = guardCancel(
    await text({
      message: "[6/9] Agent aktiv ab (Uhrzeit):",
      placeholder: "00:00",
      defaultValue: "00:00",
    })
  ) as string;
  bridge.set("schedule.activeFrom", activeFrom);

  const activeTo = guardCancel(
    await text({
      message: "Agent aktiv bis (Uhrzeit):",
      placeholder: "24:00",
      defaultValue: "24:00",
    })
  ) as string;
  bridge.set("schedule.activeTo", activeTo);

  const maxActions = guardCancel(
    await text({
      message: "Max. Aktionen pro Tag:",
      placeholder: "50",
      defaultValue: "50",
      validate: (val) => (isNaN(Number(val)) ? "Muss eine Zahl sein" : undefined),
    })
  ) as string;
  bridge.set("schedule.maxActionsPerDay", Number(maxActions));

  const planInterval = guardCancel(
    await text({
      message: "Planungs-Intervall in Minuten (AEL-Loop):",
      placeholder: "15",
      defaultValue: "15",
      validate: (val) => (isNaN(Number(val)) ? "Muss eine Zahl sein" : undefined),
    })
  ) as string;
  bridge.set("schedule.planningIntervalMinutes", Number(planInterval));

  // ============================================
  // STEP 7/9: Docker Sandboxing
  // ============================================
  const dockerEnabled = guardCancel(
    await confirm({
      message: "[7/9] Docker für Tool-Ausführung aktivieren? (Empfohlen)",
      initialValue: true,
    })
  ) as boolean;
  bridge.set("docker.enabled", dockerEnabled);

  // ============================================
  // STEP 8/9: Google Workspace (gog CLI)
  // ============================================
  const gogSetup = guardCancel(
    await confirm({
      message: "[8/9] Google Workspace aktivieren? (Gmail, Calendar, Drive, Sheets, Docs via gog CLI)",
      initialValue: true,
    })
  ) as boolean;

  if (gogSetup) {
    const gogAccount = guardCancel(
      await text({
        message: "Gmail-Adresse für gog:",
        placeholder: "dein.name@gmail.com",
        validate: (val) => {
          if (!val || !val.includes("@")) return "Gültige E-Mail-Adresse eingeben";
          return undefined;
        },
      })
    ) as string;

    note(
      [
        "gog CLI Setup:",
        "1. Installiere gog: https://github.com/steipete/gogcli/releases",
        "   (Lade die .exe für Windows herunter und füge sie zum PATH hinzu)",
        "",
        "2. Google Cloud OAuth einrichten:",
        "   - Gehe zu console.cloud.google.com → APIs & Services → Credentials",
        "   - Erstelle eine OAuth 2.0 Client-ID (Desktop-App)",
        "   - Lade die client_secret.json herunter",
        "",
        "3. gog authentifizieren:",
        `   gog auth credentials <pfad/zu/client_secret.json>`,
        `   gog auth add ${gogAccount} --services gmail,calendar,drive,contacts,sheets,docs`,
        "",
        "4. Teste die Verbindung:",
        "   gog auth list",
      ].join("\n"),
      "Setup-Anleitung"
    );

    bridge.set("gog.account", gogAccount);
    bridge.set("gog.enabled", true);
  } else {
    bridge.set("gog.enabled", false);
    note(
      "Ohne gog kann der Agent keine E-Mails senden, kein Google Calendar,\nDrive oder Sheets nutzen. Du kannst gog später aktivieren.",
      "Info"
    );
  }

  // ============================================
  // STEP 9/9: OpenClaw Skills
  // ============================================
  const openclawProbe = new OpenClawAdapter(bridge.getConfig());
  const detectedWorkspace = openclawProbe.getWorkspaceRoot();
  const fallbackWorkspace = path.resolve(process.cwd(), "openclaw-source");
  const defaultWorkspace = detectedWorkspace ?? fallbackWorkspace;
  const hasDefaultWorkspace = fs.existsSync(path.join(defaultWorkspace, "skills"))
    || fs.existsSync(path.join(defaultWorkspace, ".agents", "skills"));

  const openclawWorkspaceInput = guardCancel(
    await text({
      message: "[9/9] OpenClaw-Workspace (optional, für lokale Skills):",
      placeholder: "C:\\pfad\\zu\\openclaw",
      defaultValue: hasDefaultWorkspace ? defaultWorkspace : "",
    })
  ) as string;

  const openclawWorkspace = openclawWorkspaceInput.trim()
    ? path.resolve(openclawWorkspaceInput.trim())
    : "";
  const openclawSkillsDir = openclawWorkspace && fs.existsSync(path.join(openclawWorkspace, "skills"))
    ? path.join(openclawWorkspace, "skills")
    : "";

  bridge.set("openclaw.workspace", openclawWorkspace);
  bridge.set("openclaw.skills_dir", openclawSkillsDir);
  bridge.set("openclaw.auto_detected", !!detectedWorkspace && path.resolve(detectedWorkspace) === openclawWorkspace);
  bridge.set("openclaw.install_dir", path.join(os.homedir(), ".codex", "skills"));

  const selectedStandardSkills = guardCancel(
    await multiselect({
      message: "Welche Standard-Skills soll ich fuer deine Methoden vorbereiten?",
      options: [
        { value: "clawhub", label: "clawhub", hint: "Skill-Hub CLI fuer Suche/Install" },
        { value: "gog", label: "gog", hint: "Google Workspace Workflows" },
        { value: "skill-creator", label: "skill-creator", hint: "Neue Skills erstellen wenn Faehigkeit fehlt" },
        { value: "model-usage", label: "model-usage", hint: "Prompt- und Modellnutzung dokumentieren" },
      ],
      required: false,
    })
  ) as string[];

  const normalizedSelection = selectedStandardSkills.filter(skill => DEFAULT_STANDARD_SKILLS.includes(skill as typeof DEFAULT_STANDARD_SKILLS[number]));
  bridge.set("openclaw.standardSkills", normalizedSelection);

  if (normalizedSelection.length > 0) {
    const installNow = guardCancel(
      await confirm({
        message: "Standard-Skills jetzt direkt installieren?",
        initialValue: true,
      })
    ) as boolean;

    if (installNow) {
      const s = spinner();
      s.start("Installiere Standard-Skills...");

      const adapter = new OpenClawAdapter(bridge.getConfig());
      const installNotes: string[] = [];
      for (const skillName of normalizedSelection) {
        const result = adapter.installSkill(skillName, {
          source: "auto",
          allowClawhubFallback: true,
        });
        installNotes.push(`${result.success ? "[OK]" : "[WARN]"} ${skillName}: ${result.message}`);
      }

      s.stop("Standard-Skills verarbeitet");
      note(installNotes.join("\n"), "Skill-Setup");
    }
  }

  // ============================================
  // Finalize
  // ============================================
  bridge.set("setupComplete", true);

  // Generate GOALS.md
  const workspaceDir = bridge.getConfigDir();
  bridge.generateGoalsMd(workspaceDir);

  note(
    [
      `✅ Konfiguration gespeichert: ${bridge.getConfigPath()}`,
      `✅ GOALS.md generiert: ${workspaceDir}/GOALS.md`,
      "",
      "Nächste Schritte:",
      "  cashclaw gateway          – Gateway starten",
      "  cashclaw onboard --debug  – Setup erneut mit Debug-Ansicht",
      "  cashclaw status           – Systemstatus anzeigen",
    ].join("\n"),
    "Setup abgeschlossen"
  );

  outro("🦀 Cash-Claw ist bereit!");
}
