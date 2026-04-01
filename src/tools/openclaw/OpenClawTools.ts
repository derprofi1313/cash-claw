import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { Tool } from "../Tool.js";
import type { OpenClawAdapter } from "../../gateway/OpenClawAdapter.js";

export function createOpenClawTools(openclaw: OpenClawAdapter | null): Tool[] {
  const isAvailable = () => openclaw !== null;

  return [
    buildTool({
      name: "openclaw.skills.status",
      description: "Status der OpenClaw Skill-Integration anzeigen",
      category: "skills",
      parameterDescription: "{}",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({}),
      async call() {
        const available = openclaw!.listAvailableSkills();
        const installed = openclaw!.listInstalledSkills();
        return {
          data: {
            workspace: openclaw!.getWorkspaceRoot(),
            installRoot: openclaw!.getInstallRoot(),
            availableCount: available.length,
            installedCount: installed.length,
          },
          meta: { durationMs: 0 },
        };
      },
    }),

    buildTool({
      name: "openclaw.skills.list",
      description: "OpenClaw Skills auflisten (verfuegbar oder installiert)",
      category: "skills",
      parameterDescription: "{ query?, source?, limit? }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        query: z.string().optional().default(""),
        source: z.enum(["available", "installed", "all"]).optional().default("all"),
        limit: z.number().int().min(1).max(200).optional().default(50),
      }),
      async call(input) {
        const available = input.source === "installed" ? [] : openclaw!.listAvailableSkills(input.query);
        const installed = input.source === "available" ? [] : openclaw!.listInstalledSkills(input.query);

        const seen = new Set<string>();
        const merged = [...installed, ...available]
          .filter(skill => {
            const key = `${skill.id}::${skill.sourceType}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, input.limit);

        return {
          data: {
            query: input.query,
            source: input.source,
            count: merged.length,
            skills: merged.map(skill => ({
              id: skill.id,
              sourceType: skill.sourceType,
              path: skill.sourcePath,
              title: skill.title ?? "",
              description: skill.description ?? "",
            })),
          },
          meta: { durationMs: 0 },
        };
      },
    }),

    buildTool({
      name: "openclaw.skills.read",
      description: "SKILL.md Inhalt eines OpenClaw Skills lesen",
      category: "skills",
      parameterDescription: "{ skill, preferInstalled? }",
      readOnly: true,
      isEnabled: isAvailable,
      inputSchema: z.object({
        skill: z.string().min(1),
        preferInstalled: z.boolean().optional().default(true),
      }),
      async call(input) {
        const data = openclaw!.readSkillMarkdown(input.skill, input.preferInstalled);
        if (!data) {
          throw new Error(`Skill '${input.skill}' nicht gefunden oder SKILL.md fehlt.`);
        }
        return {
          data: {
            skill: data.skill.id,
            sourceType: data.skill.sourceType,
            sourcePath: data.skill.sourcePath,
            content: data.content,
          },
          meta: { durationMs: 0 },
        };
      },
    }),

    buildTool({
      name: "openclaw.skills.install",
      description: "OpenClaw/ClawHub Skill installieren",
      category: "skills",
      parameterDescription: "{ skill, force?, source?, allowClawhubFallback? }",
      isEnabled: isAvailable,
      destructive: true,
      concurrencySafe: false,
      inputSchema: z.object({
        skill: z.string().min(1),
        force: z.boolean().optional().default(false),
        source: z.enum(["auto", "workspace", "clawhub"]).optional().default("auto"),
        allowClawhubFallback: z.boolean().optional().default(true),
      }),
      async call(input) {
        const result = openclaw!.installSkill(input.skill, {
          force: input.force,
          source: input.source,
          allowClawhubFallback: input.allowClawhubFallback,
        });
        if (!result.success) {
          throw new Error(result.message);
        }
        return {
          data: result,
          meta: { durationMs: 0 },
        };
      },
    }),
  ];
}
