import OpenAI from 'openai';

import {CloudflareInvoice, CloudflareLineItem} from './types';

export const CLOUDFLARE_LINE_ITEM_PROPERTIES = {
  description: {
    description:
      "The full service description exactly as listed in the invoice under 'Description'.",
    type: 'string',
  },
  shortDescription: {
    description:
      'A concise summary of the service, focusing on the key service or domain name.',
    type: 'string',
  },
  quantity: {
    description:
      "The quantity of this service, found in the 'Qty' column. Usually 1 for most services.",
    type: 'integer',
    minimum: 1,
  },
  totalCents: {
    description:
      "The total amount for this line item in cents USD, as shown in the 'Amount' column. Example: '2520' is $25.20 USD.",
    type: 'number',
    minimum: 0,
  },
} as const satisfies Record<keyof CloudflareLineItem, any>;

export const CLOUDFLARE_INVOICE_PROPERTIES = {
  invoiceId: {
    description:
      "The Cloudflare invoice number, found near the top as 'Invoice number' and typically in the format 'IN-12345678'.",
    type: 'string',
  },
  lineItems: {
    description:
      'A list of services billed, each with details as they appear in the invoice line item table.',
    type: 'array',
    items: {
      type: 'object',
      properties: CLOUDFLARE_LINE_ITEM_PROPERTIES,
      required: Object.keys(CLOUDFLARE_LINE_ITEM_PROPERTIES),
      additionalProperties: false,
    },
  },
  totalCents: {
    description:
      "The total amount due in cents USD, shown at the end of the invoice under 'Amount due' or 'Total'. Example: '2520' is $25.20 USD'.",
    type: 'number',
    minimum: 0,
  },
} as const satisfies Record<keyof CloudflareInvoice, any>;

const SCHEMA = {
  type: 'json_schema',
  name: 'cloudflare_invoice',
  schema: {
    type: 'object',
    properties: CLOUDFLARE_INVOICE_PROPERTIES,
    required: Object.keys(CLOUDFLARE_INVOICE_PROPERTIES),
    additionalProperties: false,
  },
} as const;

const PROMPT = `
You are a precise and detail-oriented parser that extracts structured data from
Cloudflare invoice PDF text.

Absolute Do not make up or infer any data.

Use the exact words from the invoice when setting service descriptions and prices.
Pay special attention to:
- Domain registration/renewal fees and the specific domain names
- Service periods (e.g., "Oct 30, 2025 – Oct 29, 2026")
- Exact pricing as shown in the invoice table

IMPORTANT: For domain registrations, consolidate all related fees (registrar
fees, ICANN fees, etc.) into a single line item per domain. Do NOT create
separate line items for individual fee components like "ICANN fee" or
"Registrar fee" - combine them into one total cost per domain.

For shortDescription, focus on the key service being provided:
- For domain registrations: use the domain name (e.g., "prolink.tools renewal")
- For other services: use a brief descriptive name

Keep line items concise - group related charges together rather than splitting
every small fee into its own line item.
`;

/**
 * Uses OpenAI to extract structured invoice details from the PDF text
 */
export async function extractInvoice(
  pdfText: string,
  env: Env
): Promise<CloudflareInvoice> {
  const client = new OpenAI({apiKey: env.OPENAI_API_KEY});

  const response = await client.responses.create({
    model: 'o4-mini',
    text: {format: SCHEMA},
    input: [
      {
        role: 'system',
        content: [{type: 'input_text', text: PROMPT}],
      },
      {
        role: 'user',
        content: [{type: 'input_text', text: pdfText}],
      },
    ],
  });

  return JSON.parse(response.output_text);
}
