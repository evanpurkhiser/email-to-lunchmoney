import OpenAI from 'openai';

import type {CapitalOneFlightReceipt} from './types';

const CAPITAL_ONE_FLIGHT_PROPERTIES = {
  tripCode: {
    description: 'Capital One Travel confirmation code.',
    type: 'string',
  },
  originAirportCode: {
    description: '3-letter IATA code for the outbound origin airport.',
    type: 'string',
  },
  destinationAirportCode: {
    description: '3-letter IATA code for the outbound destination airport.',
    type: 'string',
  },
  chargedAmountCents: {
    description:
      'Amount charged to card in USD cents from the payment section. Example: 16904 for $169.04.',
    type: 'integer',
    minimum: 0,
  },
  grandTotalCents: {
    description:
      'Grand total before discounts in USD cents. Example: 46904 for Total US$469.04.',
    type: 'integer',
    minimum: 0,
  },
  totalDiscountCents: {
    description:
      'Total discounts applied in USD cents across all discount lines (credits, promotions, coupon lines). Use 0 if no discount lines are present.',
    type: 'integer',
    minimum: 0,
  },
  discountSummary: {
    description:
      'Short 3-4 word summary describing the discount type, such as "credit discount" or "promo fare discount". Use null when totalDiscountCents is 0.',
    type: ['string', 'null'],
  },
} as const satisfies Record<keyof CapitalOneFlightReceipt, any>;

const SCHEMA = {
  type: 'json_schema',
  name: 'capital_one_flight_receipt',
  schema: {
    type: 'object',
    properties: CAPITAL_ONE_FLIGHT_PROPERTIES,
    required: Object.keys(CAPITAL_ONE_FLIGHT_PROPERTIES),
    additionalProperties: false,
  },
} as const;

const PROMPT = `
You extract structured data from Capital One Travel flight confirmation emails.

Rules:
- Use only values present in the provided text.
- Do not infer missing values.
- grandTotalCents must be the pre-discount total.
- totalDiscountCents must be the sum of all discount/credit lines reducing the grand total.
- chargedAmountCents must be the amount charged to card.
- totalDiscountCents must be 0 when no discount lines exist.
- discountSummary must be 3-4 words when totalDiscountCents > 0.
- discountSummary must be null when totalDiscountCents is 0.
`;

export async function extractFlightReceipt(
  receiptText: string,
  env: Env,
): Promise<CapitalOneFlightReceipt> {
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
        content: [{type: 'input_text', text: receiptText}],
      },
    ],
  });

  return JSON.parse(response.output_text);
}
