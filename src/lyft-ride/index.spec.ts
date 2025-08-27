import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {expect, test} from 'vitest';

import {lyftRideProcessor} from '.';

const testCases = [
  {
    file: 'single-stop',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Lyft', expectedTotal: 1299},
      note: '805 Leavenworth St, San Francisco, CA → 1000 3rd Street, San Francisco, CA [12:45, 19m]',
    },
  },
  {
    file: 'multi-stop',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Lyft', expectedTotal: 4919},
      note: '326 E 4th St, New York, NY → 27 Essex St, New York, NY → 2312 Summit Ave, Union City, NJ [09:00, 45m]',
    },
  },
];

test.for(testCases)('can process $file', async ({file, expected}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  const result = await lyftRideProcessor.process(email, env);

  expect(result).toEqual(expected);
});

test.for(testCases)('does match $file', async ({file}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  expect(lyftRideProcessor.matchEmail(email)).toBe(true);
});
