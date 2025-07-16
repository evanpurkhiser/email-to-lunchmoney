import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import fixtureEmail from './fixtures/example.eml?raw';
import fixtureOrder from './fixtures/example.json';
import fixtureEmailText from './fixtures/example.txt';
import {amazonProcessor, computeItemTaxes, extractOrderBlock} from './index';
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
