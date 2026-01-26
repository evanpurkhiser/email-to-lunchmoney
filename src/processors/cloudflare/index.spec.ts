import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import fixtureEmail from './fixtures/example-invoice.eml?raw';
import {cloudflareProcessor} from './index';
import * as prompt from './prompt';
import {CloudflareInvoice} from './types';

const extractInvoiceSpy = vi.spyOn(prompt, 'extractInvoice');

describe('cloudflareProcessor', () => {
  const fixtureInvoice: CloudflareInvoice = {
    invoiceId: 'IN-48951432',
    totalCents: 2520,
    lineItems: [
      {
        description: 'Registrar Renewal Fee - prolink.tools Oct 30, 2025 – Oct 29, 2026',
        shortDescription: 'prolink.tools renewal',
        quantity: 1,
        totalCents: 2520,
      },
    ],
  };

  beforeEach(() => {
    extractInvoiceSpy.mockReturnValue(Promise.resolve(fixtureInvoice));
  });

  it('should match Cloudflare invoice emails', async () => {
    const email = await PostalMime.parse(fixtureEmail);
    expect(cloudflareProcessor.matchEmail(email)).toBe(true);
  });

  it('should process Cloudflare invoice with single line item', async () => {
    const email = await PostalMime.parse(fixtureEmail);

    const result = await cloudflareProcessor.process(email, env);

    expect(extractInvoiceSpy).toHaveBeenCalled();

    const [actualPdfText] = extractInvoiceSpy.mock.calls[0];
    expect(actualPdfText).toContain('48951432');
    expect(actualPdfText).toContain('Registrar Renewal Fee - prolink.tools');

    expect(result).toEqual({
      type: 'update',
      match: {
        expectedPayee: 'Cloudflare',
        expectedTotal: 2520,
      },
      note: 'prolink.tools renewal (IN-48951432)',
    });
  });

  it('should process Cloudflare invoice with multiple line items as split', async () => {
    const multiItemInvoice: CloudflareInvoice = {
      invoiceId: 'IN-12345678',
      totalCents: 5040,
      lineItems: [
        {
          description: 'Registrar Renewal Fee - example.com Jan 1, 2025 – Dec 31, 2025',
          shortDescription: 'example.com renewal',
          quantity: 1,
          totalCents: 2520,
        },
        {
          description: 'DNS Service - Premium Plan',
          shortDescription: 'DNS Premium',
          quantity: 1,
          totalCents: 2520,
        },
      ],
    };

    extractInvoiceSpy.mockReturnValueOnce(Promise.resolve(multiItemInvoice));

    const email = await PostalMime.parse(fixtureEmail);
    const result = await cloudflareProcessor.process(email, env);

    expect(result).toEqual({
      type: 'split',
      match: {
        expectedPayee: 'Cloudflare',
        expectedTotal: 5040,
      },
      split: [
        {
          note: 'example.com renewal (IN-12345678)',
          amount: 2520,
        },
        {
          note: 'DNS Premium (IN-12345678)',
          amount: 2520,
        },
      ],
    });
  });

  it('should include quantity notation for single item with quantity > 1', async () => {
    const singleItemWithQuantityInvoice: CloudflareInvoice = {
      invoiceId: 'IN-99887766',
      totalCents: 7560, // 3 × 2520
      lineItems: [
        {
          description: 'Workers Paid Plan - 3 instances',
          shortDescription: 'Workers Plan',
          quantity: 3,
          totalCents: 7560,
        },
      ],
    };

    extractInvoiceSpy.mockReturnValueOnce(Promise.resolve(singleItemWithQuantityInvoice));

    const email = await PostalMime.parse(fixtureEmail);
    const result = await cloudflareProcessor.process(email, env);

    expect(result).toEqual({
      type: 'update',
      match: {
        expectedPayee: 'Cloudflare',
        expectedTotal: 7560,
      },
      note: 'Workers Plan [×3] (IN-99887766)',
    });
  });

  it('should filter out zero-dollar line items', async () => {
    const invoiceWithZeroItems: CloudflareInvoice = {
      invoiceId: 'IN-22762649',
      totalCents: 1000,
      lineItems: [
        {
          description: 'Time on Cloudflare Free Plan',
          shortDescription: 'Free Plan',
          quantity: 1,
          totalCents: 0,
        },
        {
          description: 'Advanced Certificate Manager',
          shortDescription: 'Certificate Manager',
          quantity: 1,
          totalCents: 1000,
        },
      ],
    };

    extractInvoiceSpy.mockReturnValueOnce(Promise.resolve(invoiceWithZeroItems));

    const email = await PostalMime.parse(fixtureEmail);
    const result = await cloudflareProcessor.process(email, env);

    expect(result).toEqual({
      type: 'update',
      match: {
        expectedPayee: 'Cloudflare',
        expectedTotal: 1000,
      },
      note: 'Certificate Manager (IN-22762649)',
    });
  });

  it('should return null for invoice with only zero-dollar line items', async () => {
    const allZeroInvoice: CloudflareInvoice = {
      invoiceId: 'IN-00000000',
      totalCents: 0,
      lineItems: [
        {
          description: 'Time on Cloudflare Free Plan',
          shortDescription: 'Free Plan',
          quantity: 1,
          totalCents: 0,
        },
      ],
    };

    extractInvoiceSpy.mockReturnValueOnce(Promise.resolve(allZeroInvoice));

    const email = await PostalMime.parse(fixtureEmail);
    const result = await cloudflareProcessor.process(email, env);

    expect(result).toBeNull();
  });
});
