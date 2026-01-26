import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {expect, test} from 'vitest';

import {uberRideProcessor} from '.';

const testCases = [
  {
    file: 'example-1',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Uber', expectedTotal: 3680},
      note: '123 Test Street, New York, NY 10009-6925, US → 30 Test City, TS 12345 10023, US [19:30, 23m]',
    },
  },
  {
    file: 'example-2',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Uber', expectedTotal: 2096},
      note: '123 Test Street, Test City, TS 12345 → 2600 Geneva Ave, Daly City, CA [18:38, 23m]',
    },
  },
];

test.for(testCases)('can process $file', async ({file, expected}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  const result = await uberRideProcessor.process(email, env);

  expect(result).toEqual(expected);
});

test.for(testCases)('does match $file', async ({file}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  expect(uberRideProcessor.matchEmail(email)).toBe(true);
});

const nonReceiptCases = ['not-receipt-1', 'not-receipt-2'];

test.for(nonReceiptCases)('does not match non-receipt emails: %s', async file => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);

  // Should not match preliminary trip summaries
  expect(uberRideProcessor.matchEmail(email)).toBe(false);
});
