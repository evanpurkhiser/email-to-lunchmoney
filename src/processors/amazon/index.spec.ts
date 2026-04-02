import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import fixture2Email from './fixtures/example-2.eml?raw';
import fixtureEmail from './fixtures/example.eml?raw';
import fixtureDiscountedOrder from './fixtures/example-discounted.json';
import fixtureOrder from './fixtures/example.json';
import fixtureEmailText from './fixtures/example.txt';
import {amazonProcessor, computeItemTaxes, extractOrderBlock, makeDiscountedNote} from './index';
import * as prompt from './prompt';

const extractOrderSpy = vi.spyOn(prompt, 'extractOrder');

describe('Amazon order EmailProcessor', () => {
  beforeEach(() => {
    extractOrderSpy.mockReturnValue(Promise.resolve(fixtureOrder));
  });

  it('matches amazon order emails', async () => {
    const email = await PostalMime.parse(fixtureEmail);
    expect(amazonProcessor.matchEmail(email)).toBe(true);
  });

  it('processes and creates a LunchMoneyAction for amazon orders', async () => {
    const email = await PostalMime.parse(fixtureEmail);

    const result = await amazonProcessor.process(email, env);

    expect(extractOrderSpy).toHaveBeenCalled();

    expect(result).toEqual({
      match: {expectedPayee: 'Amazon', expectedTotal: 4495},
      type: 'split',
      split: [
        {
          note: 'Brushed Nickel Faucet (114-0833187-7581859)',
          amount: 2645,
        },
        {note: 'Nickel Sink Drain (114-0833187-7581859)', amount: 1850},
      ],
    });
  });
});

describe('extractOrderBlock', () => {
  it('extracts order block from Amazon email text', () => {
    const result = extractOrderBlock(fixtureEmailText);

    expect(result).toContain('Order #');
    expect(result).toContain('114-0833187-7581859');
    expect(result).toContain('Bathroom Faucet Brushed Nickel');
    expect(result).toContain('Bathroom Sink Drain Without Overflow');
    expect(result).toContain('24.29 USD');
    expect(result).toContain('16.99 USD');
    expect(result).toContain('Total');
    expect(result).toContain('44.95 USD');
    expect(result).not.toContain('©2025 Amazon.com');
  });

  it('returns null when no order block found', () => {
    const invalidEmailText = 'This is not an Amazon order email';
    const result = extractOrderBlock(invalidEmailText);

    expect(result).toBeNull();
  });

  it('returns null when order start found but no footer', () => {
    const incompleteEmailText =
      'Order #\n114-0833187-7581859\nSome content without footer';
    const result = extractOrderBlock(incompleteEmailText);

    expect(result).toBeNull();
  });

  it('extracts order block from example-2 email with 2026 footer', async () => {
    const email = await PostalMime.parse(fixture2Email);
    const result = extractOrderBlock(email.text ?? '');

    expect(result).not.toBeNull();
    expect(result).toContain('Order #');
  });
});

describe('Amazon discounted orders', () => {
  beforeEach(() => {
    extractOrderSpy.mockReturnValue(Promise.resolve(fixtureDiscountedOrder));
  });

  it('produces an update action when subtotal exceeds grand total', async () => {
    const email = await PostalMime.parse(fixtureEmail);
    const result = await amazonProcessor.process(email, env);

    expect(result).toMatchObject({
      type: 'update',
      match: {expectedPayee: 'Amazon', expectedTotal: 502},
    });
  });

  it('sets note to summarized fallback with order id, subtotal, and charged amount', async () => {
    const email = await PostalMime.parse(fixtureEmail);
    const result = await amazonProcessor.process(email, env);

    expect(result).toMatchObject({
      type: 'update',
      note: 'Amazon order 112-2812184-1194658. Subtotal $18.84, charged $5.02.\n1 item:\n- Aquaphor Healing Ointment',
    });
  });

  it('produces a summary update for multi-item discounted orders', async () => {
    extractOrderSpy.mockReturnValue(
      Promise.resolve({
        orderId: '123-1234567-1234567',
        orderItems: [
          {name: 'Widget Alpha Long Name', shortName: 'Widget Alpha', quantity: 1, priceEachCents: 2500},
          {name: 'Widget Beta Long Name', shortName: 'Widget Beta', quantity: 1, priceEachCents: 2932},
        ],
        totalCostCents: 3811,
      }),
    );

    const email = await PostalMime.parse(fixtureEmail);
    const result = await amazonProcessor.process(email, env);

    expect(result).toMatchObject({
      type: 'update',
      match: {expectedPayee: 'Amazon', expectedTotal: 3811},
      note: 'Amazon order 123-1234567-1234567. Subtotal $54.32, charged $38.11.\n2 items:\n- Widget Alpha\n- Widget Beta',
    });
  });

  it('uses split behavior when order math is valid (regression)', async () => {
    extractOrderSpy.mockReturnValue(Promise.resolve(fixtureOrder));

    const email = await PostalMime.parse(fixtureEmail);
    const result = await amazonProcessor.process(email, env);

    expect(result).toMatchObject({type: 'split'});
  });
});

describe('makeDiscountedNote', () => {
  it('uses shortName when available', () => {
    const order = {
      orderId: '111-1111111-1111111',
      orderItems: [{name: 'Full Product Name', shortName: 'Short Name', quantity: 1, priceEachCents: 1000}],
      totalCostCents: 500,
    };

    const note = makeDiscountedNote(order);
    expect(note).toContain('- Short Name');
    expect(note).not.toContain('Full Product Name');
  });

  it('falls back to name when shortName is empty', () => {
    const order = {
      orderId: '111-1111111-1111111',
      orderItems: [{name: 'Full Product Name', shortName: '', quantity: 1, priceEachCents: 1000}],
      totalCostCents: 500,
    };

    const note = makeDiscountedNote(order);
    expect(note).toContain('- Full Product Name');
  });

  it('uses singular item label for single-item orders', () => {
    const order = {
      orderId: '111-1111111-1111111',
      orderItems: [{name: 'Product', shortName: 'Product', quantity: 1, priceEachCents: 1000}],
      totalCostCents: 500,
    };

    expect(makeDiscountedNote(order)).toContain('1 item:');
  });

  it('uses plural item label for multi-item orders', () => {
    const order = {
      orderId: '111-1111111-1111111',
      orderItems: [
        {name: 'Product A', shortName: 'A', quantity: 1, priceEachCents: 500},
        {name: 'Product B', shortName: 'B', quantity: 1, priceEachCents: 600},
      ],
      totalCostCents: 400,
    };

    expect(makeDiscountedNote(order)).toContain('2 items:');
  });
});

describe('computeItemTaxes', () => {
  const i = {
    name: 'Some product',
    shortName: 'Product',
  };

  it('computes taxes for two items correctly', () => {
    const items = [
      {...i, priceEachCents: 2429, quantity: 1},
      {...i, priceEachCents: 1699, quantity: 1},
    ];
    const total = 4495; // subtotal: 4128, tax: 367

    const taxes = computeItemTaxes(items, total);
    expect(taxes).toEqual([216, 151]);
  });

  it('computes zero taxes correctly', () => {
    const items = [
      {...i, priceEachCents: 1000, quantity: 1},
      {...i, priceEachCents: 1500, quantity: 1},
    ];
    const total = 2500;

    const taxes = computeItemTaxes(items, total);
    expect(taxes).toEqual([0, 0]);
  });

  it('throws if total is less than subtotal', () => {
    const items = [{...i, priceEachCents: 1000, quantity: 1}];
    const total = 900;

    expect(() => computeItemTaxes(items, total)).toThrow();
  });

  it('handles small tax split across identical items', () => {
    const items = Array(5).fill({...i, priceEachCents: 100, quantity: 1});
    const total = 505; // subtotal: 500, tax: 5

    const taxes = computeItemTaxes(items, total);
    expect(taxes).toEqual([1, 1, 1, 1, 1]);
  });

  it('handles tricky rounding case with repeating decimals', () => {
    const items = [
      {...i, priceEachCents: 100, quantity: 1},
      {...i, priceEachCents: 200, quantity: 1},
    ];
    const total = 399; // subtotal: 300, tax: 99

    const taxes = computeItemTaxes(items, total);
    expect(taxes).toEqual([33, 66]);
  });

  it('handles fractional tax with very similar items', () => {
    const items = [
      {...i, priceEachCents: 3333, quantity: 1},
      {...i, priceEachCents: 3333, quantity: 1},
      {...i, priceEachCents: 3334, quantity: 1},
    ];
    const total = 10503; // subtotal: 10000, tax: 503

    const taxes = computeItemTaxes(items, total);
    expect(taxes).toEqual([168, 168, 167]);
  });

  it('allocates tax correctly when items differ greatly in price', () => {
    const items = [
      {...i, priceEachCents: 99, quantity: 1},
      {...i, priceEachCents: 19999, quantity: 1},
    ];
    const total = 21712; // subtotal: 20098, tax: 1614

    const taxes = computeItemTaxes(items, total);
    expect(taxes).toEqual([8, 1606]);
  });

  it('distributes tax correctly across items with quantity > 1', () => {
    const items = [
      {...i, priceEachCents: 1000, quantity: 2},
      {...i, priceEachCents: 500, quantity: 3},
    ];
    const total = 3700; // subtotal: 3500, tax: 200

    const taxes = computeItemTaxes(items, total);
    expect(taxes).toEqual([114, 86]); // 2000 gets 57.14%, 1500 gets 42.86% of 200
  });
});
