import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {expect, test} from 'vitest';

import {chaseFlightsProcessor} from '.';

const billedCases = [
  {
    file: 'receipt-billed-1',
    expected: {
      type: 'update',
      match: {expectedPayee: 'CL * Chase Travel', expectedTotal: 33850},
      note: 'JFK → MEX (JPRXYT) [used 19,964 pts, 37% discount, originally $538.14]',
    },
  },
  {
    file: 'receipt-billed-2',
    expected: {
      type: 'update',
      match: {expectedPayee: 'CL * Chase Travel', expectedTotal: 6293},
      note: 'TPE → HKG (PHJRT2) [used 24,767 pts, 80% discount, originally $310.60]',
    },
  },
  {
    file: 'receipt-points-only-1',
    expected: {
      type: 'update',
      match: {expectedPayee: 'CL * Chase Travel', expectedTotal: 9829},
      note: 'EWR → NRT (2VXAJ8) [used 53,934 pts, 89% discount, originally $907.30]',
    },
  },
];

test.for(billedCases)('can process $file', async ({file, expected}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);

  const result = await chaseFlightsProcessor.process(email, env);

  expect(result).toEqual(expected);
});

test('returns null for a 100% points redemption with no billed-to-card section', async () => {
  const emailFile = await import('./fixtures/receipt-points-only-2.eml?raw');
  const email = await PostalMime.parse(emailFile.default);

  const result = await chaseFlightsProcessor.process(email, env);

  expect(result).toBeNull();
});

test.for([...billedCases, {file: 'receipt-points-only-2'}])('does match $file', async ({file}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);

  expect(chaseFlightsProcessor.matchEmail(email)).toBe(true);
});
