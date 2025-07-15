import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {describe, expect, it} from 'vitest';

import multiStopFixture from './fixtures/multi-stop.eml?raw';
import singleStopFixture from './fixtures/single-stop.eml?raw';
import {lyftRideProcessor} from '.';

describe('Lyft Ride EmailProcessor', () => {
  it('matches lyft ride emails', async () => {
    const emailOne = await PostalMime.parse(singleStopFixture);
    expect(lyftRideProcessor.matchEmail(emailOne)).toBe(true);

    const emailTwo = await PostalMime.parse(multiStopFixture);
    expect(lyftRideProcessor.matchEmail(emailTwo)).toBe(true);
  });

  it('processes and creates a LunchMoneyAction for a single ride', async () => {
    const email = await PostalMime.parse(singleStopFixture);
    const result = await lyftRideProcessor.process(email, env);

    expect(result).toEqual({
      type: 'update',
      match: {expectedPayee: 'Lyft', expectedTotal: 1299},
      note: '805 Leavenworth St, San Francisco, CA → 1000 3rd Street, San Francisco, CA [12:45, 19m]',
    });
  });

  it('processes and creates a LunchMoneyAction for a multi-stop ride', async () => {
    const email = await PostalMime.parse(multiStopFixture);
    const result = await lyftRideProcessor.process(email, env);

    expect(result).toEqual({
      type: 'update',
      match: {expectedPayee: 'Lyft', expectedTotal: 4919},
      note: '326 E 4th St, New York, NY → 27 Essex St, New York, NY → 2312 Summit Ave, Union City, NJ [09:00, 45m]',
    });
  });
});
