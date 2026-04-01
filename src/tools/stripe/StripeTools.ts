// Stripe Tools – stripe.createPaymentLink, stripe.listPayments, stripe.getBalance
// Payment processing via Stripe API

import { z } from "zod";
import { buildTool } from "../Tool.js";
import type { Tool, ToolContext } from "../Tool.js";

/** Factory: creates Stripe tools */
export function createStripeTools(secretKey: string | null): Tool[] {
  const isAvailable = () => secretKey !== null && secretKey.length > 0;

  async function stripeApi(endpoint: string, body?: Record<string, string>): Promise<unknown> {
    const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    return res.json();
  }

  return [
    buildTool({
      name: "stripe.createPaymentLink",
      description: "Stripe Payment Link erstellen",
      category: "payments",
      parameterDescription: "{ name, amount, currency? }",
      destructive: true,
      concurrencySafe: false,
      isEnabled: isAvailable,

      inputSchema: z.object({
        name: z.string().min(1).describe("Produktname"),
        amount: z.number().positive().describe("Betrag in Euro/Dollar"),
        currency: z.string().default("eur").describe("Währung (default: eur)"),
      }),

      checkPermissions(input, ctx) {
        // Always confirm stripe operations
        return { behavior: "confirm", message: `Payment Link erstellen: ${input.name} (${input.amount} ${input.currency})` };
      },

      async call(input) {
        const start = Date.now();
        const amountCents = Math.round(input.amount * 100);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const price = await stripeApi("prices", {
          "unit_amount": String(amountCents),
          "currency": input.currency.toLowerCase(),
          "product_data[name]": input.name,
        }) as any;
        if (price.error) throw new Error(price.error.message);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const link = await stripeApi("payment_links", {
          "line_items[0][price]": price.id,
          "line_items[0][quantity]": "1",
        }) as any;
        if (link.error) throw new Error(link.error.message);

        return {
          data: { url: link.url, id: link.id, amount: input.amount, currency: input.currency },
          meta: { durationMs: Date.now() - start },
        };
      },
    }),

    buildTool({
      name: "stripe.listPayments",
      description: "Letzte Zahlungen auflisten",
      category: "payments",
      parameterDescription: "{ limit? }",
      readOnly: true,
      isEnabled: isAvailable,

      inputSchema: z.object({
        limit: z.number().min(1).max(100).default(10).describe("Max Anzahl (default: 10)"),
      }),

      async call(input) {
        const start = Date.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const charges = await stripeApi(`charges?limit=${input.limit}`) as any;
        if (charges.error) throw new Error(charges.error.message);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payments = (charges.data ?? []).map((c: any) => ({
          id: c.id,
          amount: (c.amount ?? 0) / 100,
          currency: c.currency,
          status: c.status,
          description: c.description,
          created: new Date((c.created ?? 0) * 1000).toISOString(),
        }));

        return { data: payments, meta: { durationMs: Date.now() - start } };
      },
    }),

    buildTool({
      name: "stripe.getBalance",
      description: "Stripe-Kontostand abfragen",
      category: "payments",
      parameterDescription: "{}",
      readOnly: true,
      isEnabled: isAvailable,

      inputSchema: z.object({}),

      async call() {
        const start = Date.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const balance = await stripeApi("balance") as any;
        if (balance.error) throw new Error(balance.error.message);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const available = (balance.available ?? []).map((b: any) => ({
          amount: (b.amount ?? 0) / 100,
          currency: b.currency,
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pending = (balance.pending ?? []).map((b: any) => ({
          amount: (b.amount ?? 0) / 100,
          currency: b.currency,
        }));

        return { data: { available, pending }, meta: { durationMs: Date.now() - start } };
      },
    }),
  ];
}
