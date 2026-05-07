import {env, SELF} from 'cloudflare:test';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import fixtureEmail from './fixtures/example.eml?raw';
import {overrideProcessors} from './index';
import type {EmailProcessor, LunchMoneyAction} from './types';
import * as telegram from './telegram';

describe('/ingest Endpoint', () => {
  const exampleAction: LunchMoneyAction = {
    type: 'update',
    match: {expectedPayee: 'Example Payee', expectedTotal: 100},
    note: 'Updated note',
  };

  const exampleProcessor: EmailProcessor = {
    identifier: 'example',
    matchEmail: vi.fn(() => true),
    process: vi.fn(() => Promise.resolve(exampleAction)),
  };

  beforeEach(() => {
    overrideProcessors([exampleProcessor]);
    env.VERBOSE_BOT = undefined;
    vi.restoreAllMocks();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const request = new Request('http://localhost/ingest', {
      method: 'POST',
      body: btoa(fixtureEmail),
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toBe('Unauthorized');
  });

  it('returns 401 when Authorization header has invalid format', async () => {
    const request = new Request('http://localhost/ingest', {
      method: 'POST',
      headers: {Authorization: 'InvalidFormat token123'},
      body: btoa(fixtureEmail),
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toBe('Bad Request');
  });

  it('returns 401 when token is invalid', async () => {
    const request = new Request('http://localhost/ingest', {
      method: 'POST',
      headers: {Authorization: 'Bearer wrong-token'},
      body: btoa(fixtureEmail),
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toBe('Unauthorized');
  });

  it('returns 400 when request body is empty', async () => {
    const request = new Request('http://localhost/ingest', {
      method: 'POST',
      headers: {Authorization: `Bearer ${env.INGEST_TOKEN}`},
      body: '',
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({error: 'Empty request body'});
  });

  it('returns 202 and processes email with valid token', async () => {
    const request = new Request('http://localhost/ingest', {
      method: 'POST',
      headers: {Authorization: `Bearer ${env.INGEST_TOKEN}`},
      body: btoa(fixtureEmail),
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({message: 'Accepted'});

    // Verify action was stored correctly
    const {results} = await env.DB.prepare('SELECT * FROM lunchmoney_actions').all();
    expect(results).toHaveLength(1);
    expect(results[0].action).toEqual(JSON.stringify(exampleAction));
  });

  it('sends a verbose telegram message when a new action is recorded', async () => {
    env.VERBOSE_BOT = 'true';
    vi.spyOn(telegram, 'sendVerboseTelegramMessage').mockResolvedValue(undefined);

    const request = new Request('http://localhost/ingest', {
      method: 'POST',
      headers: {Authorization: `Bearer ${env.INGEST_TOKEN}`},
      body: btoa(fixtureEmail),
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(202);
    for (let i = 0; i < 20; i++) {
      if (telegram.sendVerboseTelegramMessage.mock.calls.length > 0) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    expect(telegram.sendVerboseTelegramMessage).toHaveBeenCalledOnce();
    expect(telegram.sendVerboseTelegramMessage.mock.calls[0]?.[1]).toContain(
      'New action recorded',
    );
  });
});
