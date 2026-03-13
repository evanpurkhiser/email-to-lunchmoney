import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {expect, test} from 'vitest';

import {bookingProcessor} from '.';

const testCases = [
  {
    file: 'receipt-usd',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Booking.com', expectedTotal: 118038},
      note: 'Holiday Inn San Francisco - Golden Gateway by IHG with No Resort Fee — Mar 2–Mar 8 (6 nights)',
    },
  },
  {
    file: 'receipt-usd-chicago',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Booking.com', expectedTotal: 25356},
      note: 'Arlo Chicago — Jul 12–Jul 13 (1 night)',
    },
  },
  {
    file: 'confirmation-usd',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Booking.com', expectedTotal: 152633},
      note: 'Holiday Inn San Francisco - Golden Gateway newly renovated with No Resort Fee — Mar 8–Mar 12 (4 nights)',
    },
  },
];

test.for(testCases)('can process $file', async ({file, expected}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);

  const result = await bookingProcessor.process(email, env);

  expect(result).toEqual(expected);
});

test.for(testCases)('does match $file', async ({file}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  expect(bookingProcessor.matchEmail(email)).toBe(true);
});

test('ignores non-USD currency receipts', async () => {
  const emailFile = await import('./fixtures/receipt-cad-toronto.eml?raw');
  const email = await PostalMime.parse(emailFile.default);

  // Should match the email (it's from booking.com with correct subject)
  expect(bookingProcessor.matchEmail(email)).toBe(true);

  // But should return null when processing (no USD amount found)
  const result = await bookingProcessor.process(email, env);
  expect(result).toBeNull();
});
