import OpenAI from 'openai';

import {AmazonOrder, AmazonOrderItem} from './types';

export const AMAZON_ORDER_ITEM_PROPERTIES = {
  name: {
    description: "The full product title exactly as listed in the email under 'Ordered'.",
    type: 'string',
  },
  shortName: {
    description:
      'A concise 2–4 word summary of the product, combining brand and primary descriptor.',
    type: 'string',
  },
  quantity: {
    description:
      "The quantity of this item, found under the product title in the email. Example: 'Quantity: 1'.",
    type: 'integer',
    minimum: 1,
  },
  priceEachCents: {
    description:
      "The price per unit of the product in cents USD, as shown beneath the quantity. Example: '2495' is $24.95 USD.",
    type: 'number',
    minimum: 0,
  },
} as const satisfies Record<keyof AmazonOrderItem, any>;

export const AMAZON_ORDER_PROPERTIES = {
  orderId: {
    description:
      "The Amazon order number, found near the delivery address and typically in the format '123-1234567-1234567'.",
    type: 'string',
  },
  orderItems: {
    description:
      'A list of products ordered, each with details as they appear in the email under the item listing.',
    type: 'array',
    items: {
      type: 'object',
      properties: AMAZON_ORDER_ITEM_PROPERTIES,
      required: Object.keys(AMAZON_ORDER_ITEM_PROPERTIES),
      additionalProperties: false,
    },
  },
  totalCostCents: {
    description:
      "The total cost of the order in cents USD, shown at the end of the email under 'Total'. Example: '2716' is $27.16 USD'.",
    type: 'number',
    minimum: 0,
  },
} as const satisfies Record<keyof AmazonOrder, any>;

const SCHEMA = {
  type: 'json_schema',
  name: 'meals',
  schema: {
    type: 'object',
    properties: AMAZON_ORDER_PROPERTIES,
    required: Object.keys(AMAZON_ORDER_PROPERTIES),
    additionalProperties: false,
  },
} as const;

const PROMPT = `
You are a precise and detail-oriented parser that extracts structured data from
Amazon plain text order confirmation emails.

Absolute Do not make up or infer any data.

Use the exact words from the email when setting product names and prices.
`;

/**
 * Uses OpenAI to extract structured ordere details from the email
 */
export async function extractOrder(order: string, env: Env): Promise<AmazonOrder> {
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
        content: [{type: 'input_text', text: order}],
      },
    ],
  });

  return JSON.parse(response.output_text);
}
