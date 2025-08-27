import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {expect, test} from 'vitest';

import {appleEmailProcessor} from '.';

const testCases = [
  {
    file: 'example-1',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Apple', expectedTotal: 999},
      note: 'iCloud+ with 2 TB of Storage, Monthly',
    },
  },
  {
    file: 'example-2',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Apple', expectedTotal: 599},
      note: 'EPIK - AI Photo Editor, Yearbook Express discount',
    },
  },
  {
    file: 'example-3',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Apple', expectedTotal: 2600},
      note: 'Timeleft - Meet New People, Timeleft X (Monthly)',
    },
  },
];

test.for(testCases)('can process $file', async ({file, expected}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  const result = await appleEmailProcessor.process(email, env);

  expect(result).toEqual(expected);
});

test.for(testCases)('does match $file', async ({file}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  expect(appleEmailProcessor.matchEmail(email)).toBe(true);
});
