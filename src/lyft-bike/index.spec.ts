import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {expect, test} from 'vitest';

import {lyftBikeProcessor} from '.';

const testCases = [
  {
    file: 'example',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Lyft Bike', expectedTotal: 245},
      note: 'E 2 St & Ave C → E 5 St & Ave C [12:37, 9m]',
    },
  },
];

test.for(testCases)('can process $file', async ({file, expected}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  const result = await lyftBikeProcessor.process(email, env);

  expect(result).toEqual(expected);
});

test.for(testCases)('does match $file', async ({file}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  expect(lyftBikeProcessor.matchEmail(email)).toBe(true);
});
