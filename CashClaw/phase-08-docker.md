# Phase 8: Docker Sandbox Enforcement

## Ziel

Alle Tool-Ausführungen durch den autonomen Agent sollen in isolierten Docker-Containern stattfinden. Das verhindert, dass der Agent das Host-System beschädigt, Dateien außerhalb des vorgesehenen Workspaces liest/schreibt oder Netzwerkzugriffe vornimmt, die nicht erlaubt sind.

---

## Technologie

```bash
pnpm add dockerode
pnpm add -D @types/dockerode
```

Docker muss auf dem Host-System installiert sein (`docker` CLI + Docker Daemon).

---

## Zu erstellende Dateien

### 1. `src/gateway/DockerSandbox.ts` (Kern-Klasse)

```typescript
export interface SandboxOptions {
  image: string             // Default: 'node:22-alpine'
  memoryMB: number          // Default: 512
  cpuQuota: number          // Default: 50000 (50% eines Cores)
  timeoutMs: number         // Default: 30000 (30s)
  allowNetwork: boolean     // Default: false
  workdir: string           // Gemountetes Arbeitsverzeichnis
  env: Record<string, string>
}

export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timedOut: boolean
}

export class DockerSandbox {
  constructor(private docker: Dockerode, private options: SandboxOptions) {}

  async run(command: string[]): Promise<SandboxResult>
  async runScript(code: string, language: 'node' | 'python' | 'bash'): Promise<SandboxResult>
  private async pullImageIfMissing(image: string): Promise<void>
  private createContainerConfig(command: string[]): Dockerode.ContainerCreateOptions
  static isDockerAvailable(): Promise<boolean>
}
```

**Sicherheits-Anforderungen:**

- **Read-only Filesystem:** Container-Root ist read-only (`ReadonlyRootfs: true`)
- **Kein Netzwerk** wenn `allowNetwork: false`: `NetworkMode: 'none'`
- **Memory Limit:** Hard limit via `Memory: options.memoryMB * 1024 * 1024`
- **CPU Limit:** Via `CpuQuota` + `CpuPeriod`
- **No Privilege Escalation:** `SecurityOpt: ['no-new-privileges']`
- **Dropped Capabilities:** `CapDrop: ['ALL']`
- **Timeout:** Container wird nach `timeoutMs` ms hard-killed
- **Workspace Mount:** Nur `~/.cashclaw/workspace/` wird gemountet (rw), alles andere ist read-only oder nicht vorhanden
- **Tmp:** `/tmp` als tmpfs, max 64MB

### 2. `src/gateway/SandboxManager.ts`

Verwaltet den Sandbox-Pool und entscheidet, welche Tools sandboxed ausgeführt werden:

```typescript
export class SandboxManager {
  // Tools die IMMER gesandboxed laufen:
  private readonly SANDBOXED_TOOLS = [
    'execute_code',
    'run_script',
    'browser_*',
    'fs_write',
    'fs_delete',
  ]

  // Tools die NIE sandboxed laufen (brauchen Host-Zugriff):
  private readonly HOST_TOOLS = [
    'send_telegram_message',
    'send_whatsapp_message',
    'stripe_*',
    'llm_query',
  ]

  async executeInSandbox(tool: string, params: unknown): Promise<SandboxResult>
  shouldSandbox(toolName: string): boolean
  async getDockerStatus(): Promise<{ available: boolean; version: string }>
}
```

### 3. `src/tools/sandbox/ExecuteCodeTool.ts`

Neues Tool für sicheres Code-Ausführen:

```typescript
export class ExecuteCodeTool extends Tool {
  name = 'execute_code'
  description = 'Executes code safely in a Docker sandbox'

  // Unterstützte Sprachen:
  // - javascript / node
  // - python
  // - bash / sh

  async execute(params: {
    code: string
    language: 'javascript' | 'python' | 'bash'
    timeoutMs?: number
  }): Promise<ToolResult>
}
```

### 4. `Dockerfile.sandbox` (Root-Level)

```dockerfile
# Leichtgewichtiges Sandbox-Image für CashClaw Tool-Execution
FROM node:22-alpine

# Security hardening
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox
RUN apk add --no-cache python3 bash curl

WORKDIR /workspace
USER sandbox

# Kein CMD – wird von DockerSandbox dynamisch gesetzt
```

### 5. `src/config/types.ts` – Erweiterung

```typescript
sandbox?: {
  enabled: boolean           // Default: true wenn Docker verfügbar
  image: string              // Default: 'cashclaw/sandbox:latest'
  memoryMB: number           // Default: 512
  cpuPercent: number         // Default: 50
  timeoutSeconds: number     // Default: 30
  allowNetwork: boolean      // Default: false
  workspacePath: string      // Default: ~/.cashclaw/workspace
}
```

### 6. `src/cli/onboarding.ts` – Erweiterung

Docker-Check im Onboarding:

```
Checking Docker availability... ✓ Docker 24.0.7 found
? Enable Docker sandbox for tool execution? (Y/n)
? Memory limit per sandbox (MB): (512)
? CPU limit per sandbox (%): (50)
? Execution timeout (seconds): (30)
```

Wenn Docker nicht verfügbar:
```
⚠ Docker not found. Sandbox enforcement disabled.
  Install Docker: https://docs.docker.com/get-docker/
  The agent will run tools directly on the host (less secure).
```

---

## Graceful Fallback

Wenn Docker nicht verfügbar ist oder `sandbox.enabled = false`:
- Tools laufen direkt auf dem Host (bisheriges Verhalten)
- Warning-Log bei jedem Tool-Aufruf: `[WARN] Running tool '${tool}' without sandbox`
- Status-Endpoint zeigt `sandboxed: false`

---

## Integration in AgentRuntime.ts

```typescript
// Vor jeder Tool-Ausführung:
const result = this.sandboxManager.shouldSandbox(toolName)
  ? await this.sandboxManager.executeInSandbox(toolName, params)
  : await this.toolRegistry.execute(toolName, params)
```

---

## Tests

Erstelle `src/gateway/DockerSandbox.test.ts`:

- Unit-Test: `shouldSandbox('execute_code')` → `true`
- Unit-Test: `shouldSandbox('send_telegram_message')` → `false`
- Integration-Test (requires Docker): Einfaches `echo hello` läuft in Container
- Integration-Test: Timeout wird nach `timeoutMs` ausgelöst
- Integration-Test: Kein Netzwerkzugriff wenn `allowNetwork: false`
- Unit-Test: Fallback wenn Docker nicht verfügbar

---

## Docker Compose (optional, für Entwicklung)

Erstelle `docker-compose.yml` im Root:

```yaml
version: '3.8'
services:
  cashclaw:
    build: .
    volumes:
      - ~/.cashclaw:/root/.cashclaw
      - /var/run/docker.sock:/var/run/docker.sock  # Docker-in-Docker
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

---

## Definition of Done

- [ ] Docker-Check beim Start: automatische Erkennung
- [ ] `execute_code` Tool läuft im Container
- [ ] Memory/CPU/Timeout-Limits werden enforced
- [ ] Kein Netzwerkzugriff im Container (default)
- [ ] Host-Tools (Telegram, Stripe etc.) laufen weiterhin direkt
- [ ] Graceful Fallback wenn kein Docker
- [ ] `pnpm build` fehlerfrei
- [ ] Tests grün (Unit + Integration)
- [ ] `README.md` aktualisiert: Docker-Sektion
