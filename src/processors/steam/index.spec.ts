import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {expect, test} from 'vitest';

import {steamEmailProcessor} from '.';

const testCases = [
  {
    file: 'example-1',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Steam', expectedTotal: 543},
      note: 'Geometry Dash',
    },
  },
  {
    file: 'example-2',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Steam', expectedTotal: 3483},
      note: 'Arc Raiders',
    },
  },
];

test.for(testCases)('can process $file', async ({file, expected}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);

  const result = await steamEmailProcessor.process(email, env);

  expect(result).toEqual(expected);
});

test.for(testCases)('does match $file', async ({file}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  expect(steamEmailProcessor.matchEmail(email)).toBe(true);
});
