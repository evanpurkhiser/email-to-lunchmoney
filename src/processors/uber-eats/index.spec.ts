import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {expect, test} from 'vitest';

import {uberEatsProcessor} from '.';

const testCases = [
  {
    file: 'example-1',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Uber Eats', expectedTotal: 5054},
      note: 'Boogy & Peel (Dupont) → 123 Test Street, Test City, TS 12345, US [18:16, 18m]',
    },
  },
];

test.for(testCases)('can process $file', async ({file, expected}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  const result = await uberEatsProcessor.process(email, env);

  expect(result).toEqual(expected);
});

test.for(testCases)('does match $file', async ({file}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  expect(uberEatsProcessor.matchEmail(email)).toBe(true);
});

test('can process tip-added-later (two separate charges)', async () => {
  const emailFile = await import(`./fixtures/tip-added-later.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  const result = await uberEatsProcessor.process(email, env);

  const note =
    'Boogy & Peel (Dupont) → 123 Test Street, Test City, TS 12345, US [18:16, 18m]';

  expect(result).toEqual([
    {type: 'update', match: {expectedPayee: 'Uber Eats', expectedTotal: 5054}, note},
    {
      type: 'update',
      match: {expectedPayee: 'Uber Eats', expectedTotal: 1505},
      note: `Tip: ${note}`,
    },
  ]);
});

test('does match tip-added-later', async () => {
  const emailFile = await import(`./fixtures/tip-added-later.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  expect(uberEatsProcessor.matchEmail(email)).toBe(true);
});

const nonReceiptCases = ['not-receipt-1'];

test.for(nonReceiptCases)('does not match non-receipt emails: %s', async file => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);

  expect(uberEatsProcessor.matchEmail(email)).toBe(false);
});
