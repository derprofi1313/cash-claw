// WhatsApp Tools – whatsapp.send
// Communication tool for operator interaction via WhatsApp

import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { WhatsAppAdapter } from "../../gateway/WhatsAppAdapter.js";

/** Factory: creates WhatsApp tools bound to a WhatsAppAdapter instance */
export function createWhatsAppTools(whatsapp: WhatsAppAdapter | null) {
  const isAvailable = () => whatsapp !== null;

  const SendWhatsAppMessageTool = buildTool({
    name: "whatsapp.send",
    description: "Sends a WhatsApp message to the operator",
    category: "communication",
    parameterDescription: "{ message } – Nachrichtentext",
    readOnly: false,
    concurrencySafe: true,
    isEnabled: isAvailable,

    inputSchema: z.object({
      message: z.string().min(1).describe("Nachrichtentext"),
    }),

    async call(input) {
      const start = Date.now();
      await whatsapp!.sendToOperator(input.message);
      return {
        data: "WhatsApp Nachricht gesendet",
        meta: { durationMs: Date.now() - start },
      };
    },
  });

  return [SendWhatsAppMessageTool] as const;
}
