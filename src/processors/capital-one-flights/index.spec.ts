import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import fixtureEmail from './fixtures/receipt-1.eml?raw';
import {capitalOneFlightsProcessor, extractReceiptBlock} from './index';
import * as prompt from './prompt';

const extractFlightReceiptSpy = vi.spyOn(prompt, 'extractFlightReceipt');

describe('capitalOneFlightsProcessor', () => {
  beforeEach(() => {
    extractFlightReceiptSpy.mockResolvedValue({
      tripCode: 'H-H-G4K8NY7KW4',
      originAirportCode: 'LGA',
      destinationAirportCode: 'ORD',
      grandTotalCents: 46904,
      totalDiscountCents: 30000,
      discountSummary: 'credit discount',
      chargedAmountCents: 16904,
    });
  });

  it('matches Capital One flight detail emails', async () => {
    const email = await PostalMime.parse(fixtureEmail);
    expect(capitalOneFlightsProcessor.matchEmail(email)).toBe(true);
  });

  it('processes Capital One flight detail emails', async () => {
    const email = await PostalMime.parse(fixtureEmail);

    const result = await capitalOneFlightsProcessor.process(email, env);

    expect(extractFlightReceiptSpy).toHaveBeenCalledOnce();
    const [parsedText] = extractFlightReceiptSpy.mock.calls[0];
    expect(parsedText).toContain('Capital One Travel\nH-H-G4K8NY7KW4');
    expect(parsedText).toContain('Card Payment from Capital One Venture');
    expect(parsedText).toContain('X Visa *1684 $169.04');
    expect(parsedText).toContain('Annual Travel Credit Applied -$300.00');

    expect(result).toEqual({
      type: 'update',
      match: {
        expectedPayee: 'Capital One Travel',
        expectedTotal: 16904,
      },
      note: 'LGA → ORD (H-H-G4K8NY7KW4) [total $469.04, $300.00 credit discount]',
    });
  });

  it('omits totals section when no discount is present', async () => {
    extractFlightReceiptSpy.mockResolvedValueOnce({
      tripCode: 'H-H-G4K8NY7KW4',
      originAirportCode: 'LGA',
      destinationAirportCode: 'ORD',
      grandTotalCents: 16904,
      totalDiscountCents: 0,
      discountSummary: null,
      chargedAmountCents: 16904,
    });

    const email = await PostalMime.parse(fixtureEmail);
    const result = await capitalOneFlightsProcessor.process(email, env);

    expect(result).toEqual({
      type: 'update',
      match: {
        expectedPayee: 'Capital One Travel',
        expectedTotal: 16904,
      },
      note: 'LGA → ORD (H-H-G4K8NY7KW4)',
    });
  });
});

describe('extractReceiptBlock', () => {
  it('extracts the useful receipt block from email text', () => {
    const text = [
      'intro',
      'Your confirmation codes',
      'content',
      'Airline Fare Rules Outbound Flight',
      'footer',
    ].join('\n');

    expect(extractReceiptBlock(text)).toBe('Your confirmation codes\ncontent');
  });

  it('returns full text when markers are missing', () => {
    const text = 'no markers here';
    expect(extractReceiptBlock(text)).toBe(text);
  });
});
