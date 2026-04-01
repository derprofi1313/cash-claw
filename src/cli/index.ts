#!/usr/bin/env node
// Cash-Claw CLI Entry Point

import { Command } from "commander";
import { runOnboardWizard } from "./onboard.js";
import { runStandaloneDebugConsole } from "./DebugConsole.js";
import { GatewayServer } from "../gateway/GatewayServer.js";
import { encryptConfigFile, isEncryptedConfig, decryptConfigFile } from "../config/ConfigEncryption.js";

const program = new Command();

program
  .name("cashclaw")
  .description("Cash-Claw – Autonomer KI-Agent auf OpenClaw-Basis")
  .version("0.1.0");

program
  .command("onboard")
  .description("Interaktiver Setup-Wizard für Cash-Claw")
  .option("--debug", "Debug-Modus: Zeigt live Config- und API-Events", false)
  .action(async (opts: { debug: boolean }) => {
    await runOnboardWizard(opts.debug);
  });

program
  .command("debug-console")
  .description("Standalone Debug-Konsole (empfängt Events via stdin)")
  .action(() => {
    runStandaloneDebugConsole();
  });

program
  .command("gateway")
  .description("Cash-Claw Gateway starten (AEL + Telegram + LLM)")
  .option("--port <port>", "Server Port", "3847")
  .option("--debug", "Debug-Modus: Zeigt live Agent-Gedanken, Pläne und API-Calls", false)
  .action(async (opts: { port: string; debug: boolean }) => {
    const server = new GatewayServer({
      port: Number(opts.port),
      debug: opts.debug,
    });
    await server.start();
  });

program
  .command("status")
  .description("Zeigt den aktuellen Systemstatus")
  .action(async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const configPath = path.join(os.homedir(), ".cashclaw", "config.json");

    if (!fs.existsSync(configPath)) {
      console.log("❌ Keine Konfiguration gefunden.");
      console.log("   Führe zuerst aus: cashclaw onboard");
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    console.log("🦀 Cash-Claw Status");
    console.log("─".repeat(40));
    console.log(`  Setup:      ${config.setupComplete ? "✅ Abgeschlossen" : "❌ Offen"}`);
    console.log(`  LLM:        ${config.llm?.provider ?? "–"} / ${config.llm?.model ?? "–"}`);
    console.log(`  Plattform:  ${config.platform?.type ?? "–"}`);
    console.log(`  Stripe:     ${config.stripe?.secretKey ? "✅ Konfiguriert" : "❌ Fehlt"}`);
    console.log(`  Kategorien: ${Object.entries(config.categories ?? {}).filter(([, v]) => v).map(([k]) => k).join(", ") || "–"}`);
    console.log(`  Docker:     ${config.docker?.enabled ? "✅ Aktiv" : "❌ Aus"}`);
    console.log(`  Config:     ${configPath}`);
    console.log(`  Erstellt:   ${config.createdAt ?? "–"}`);
    console.log(`  Aktualisiert: ${config.updatedAt ?? "–"}`);
  });

program
  .command("encrypt")
  .description("Config-Datei mit AES-256-GCM verschlüsseln")
  .requiredOption("--password <password>", "Verschlüsselungs-Passwort")
  .action(async (opts: { password: string }) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const configPath = path.join(os.homedir(), ".cashclaw", "config.json");

    if (!fs.existsSync(configPath)) {
      console.log("❌ Keine Config gefunden. Führe zuerst 'cashclaw onboard' aus.");
      return;
    }
    if (isEncryptedConfig(configPath)) {
      console.log("ℹ️  Config ist bereits verschlüsselt.");
      return;
    }
    encryptConfigFile(configPath, opts.password);
    console.log("🔒 Config verschlüsselt (AES-256-GCM).");
    console.log("   Starte den Gateway mit: CASHCLAW_CONFIG_PASSWORD=... cashclaw gateway");
  });

program
  .command("decrypt")
  .description("Verschlüsselte Config-Datei entschlüsseln")
  .requiredOption("--password <password>", "Entschlüsselungs-Passwort")
  .action(async (opts: { password: string }) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const configPath = path.join(os.homedir(), ".cashclaw", "config.json");

    if (!fs.existsSync(configPath)) {
      console.log("❌ Keine Config gefunden.");
      return;
    }
    if (!isEncryptedConfig(configPath)) {
      console.log("ℹ️  Config ist nicht verschlüsselt.");
      return;
    }
    try {
      const plaintext = decryptConfigFile(configPath, opts.password);
      fs.writeFileSync(configPath, plaintext, "utf-8");
      console.log("🔓 Config entschlüsselt.");
    } catch {
      console.log("❌ Falsches Passwort oder beschädigte Datei.");
    }
  });

program.parse();
