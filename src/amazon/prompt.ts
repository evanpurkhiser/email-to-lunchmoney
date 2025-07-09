import OpenAI from 'openai';

/**
 * A structured representation of an Amazon order extracted from an email.
 */
export interface AmazonOrder {
  /**
   * The Amazon order number, e.g. "114-9193968-9091445".
   */
  order_id: string;
  /**
   * The city and state from the shipping address, e.g. "NEW YORK, NY".
   */
  shipping_address_city: string;
  /**
   * A list of items included in the order.
   */
  order_items: AmazonOrderItem[];
  /**
   * The total cost of the order in USD, found at the bottom of the email.
   */
  total_cost_usd: number;
}

/**
 * A single item listed in an Amazon order.
 */
export interface AmazonOrderItem {
  /**
   * The full product title as shown in the email under “Ordered”.
   */
  name: string;
  /**
   * A concise 2–4 word summary of the item (brand + descriptor).
   */
  short_name: string;
  /**
   * The number of units ordered for this item.
   */
  quantity: number;
  /**
   * The price of a single unit in USD.
   */
  price_each_usd: number;
}

export const AMAZON_ORDER_ITEM_PROPERTIES = {
  name: {
    description: "The full product title exactly as listed in the email under 'Ordered'.",
    type: 'string',
  },
  short_name: {
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
  price_each_usd: {
    description:
      "The price per unit of the product in USD, as shown beneath the quantity. Example: '24.95 USD'.",
    type: 'number',
    minimum: 0,
  },
} as const satisfies Record<keyof AmazonOrderItem, any>;

export const AMAZON_ORDER_PROPERTIES = {
  order_id: {
    description:
      "The Amazon order number, found near the delivery address and typically in the format '123-1234567-1234567'.",
    type: 'string',
  },
  shipping_address_city: {
    description:
      "The city and state portion of the shipping address as shown near the delivery estimate. Example: 'NEW YORK, NY'.",
    type: 'string',
  },
  order_items: {
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
  total_cost_usd: {
    description:
      "The total cost of the order in USD, shown at the end of the email under 'Total'. Example: '27.16 USD'.",
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
