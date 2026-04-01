#!/usr/bin/env node
// Cash-Claw CLI Entry Point

import { Command } from "commander";
import { runOnboardWizard } from "./onboard.js";
import { runStandaloneDebugConsole } from "./DebugConsole.js";
import { GatewayServer } from "../gateway/GatewayServer.js";

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

program.parse();
