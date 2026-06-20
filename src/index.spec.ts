import {env, SELF} from 'cloudflare:test';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import fixtureEmail from './fixtures/example.eml?raw';
import {overrideProcessors} from './index';
import * as scheduledRun from './scheduled-run';
import * as telegram from './telegram';
import {handleTelegramWebhook} from './telegram-webhook';
import type {EmailProcessor, LunchMoneyAction} from './types';

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
    env.TELEGRAM_CHAT_ID = '12345';
    env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
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
      'New email processed',
    );
  });

  it('returns 401 for telegram webhook requests with an invalid secret', async () => {
    const request = new Request('http://localhost/telegram/webhook', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        message: {
          chat: {id: 12345},
          text: '/show_db',
        },
      }),
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(401);
  });

  it('shows recent pending rows for /show_db', async () => {
    vi.spyOn(telegram, 'sendTelegramMessageToChat').mockResolvedValue(undefined);

    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)',
    )
      .bind(
        'amazon',
        JSON.stringify({
          type: 'update',
          match: {expectedPayee: 'Amazon', expectedTotal: 3594},
          note: 'Ensure Protein Shake (113-8683679-4702620)',
        }),
        '2026-04-08 17:42:14',
      )
      .run();

    const request = new Request('http://localhost/telegram/webhook?secret=webhook-secret', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          chat: {id: 12345},
          text: '/show_db',
        },
      }),
    });

    const response = await handleTelegramWebhook(
      request,
      env,
      (() => undefined) as ExecutionContext['waitUntil'],
    );

    expect(response.status).toBe(200);
    expect(telegram.sendTelegramMessageToChat).toHaveBeenCalledOnce();
    expect(telegram.sendTelegramMessageToChat).toHaveBeenCalledWith(
      env,
      '12345',
      expect.stringContaining('Pending actions'),
    );
    expect(telegram.sendTelegramMessageToChat.mock.calls[0]?.[2]).toContain(
      'Ensure Protein Shake',
    );
  });

  it('runs the full scheduled flow for /run_now', async () => {
    vi.spyOn(telegram, 'sendTelegramMessageToChat').mockResolvedValue(undefined);
    vi.spyOn(scheduledRun, 'runScheduledTasks').mockResolvedValue({
      pendingActions: 3,
      processedActions: 2,
      oldActionsNotified: 1,
      cleanedUpActions: 0,
    });

    const request = new Request('http://localhost/telegram/webhook?secret=webhook-secret', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          chat: {id: 12345},
          text: '/run_now',
        },
      }),
    });

    const pending: Promise<void>[] = [];
    const waitUntil: ExecutionContext['waitUntil'] = promise => {
      pending.push(promise.then(() => undefined));
    };

    const response = await handleTelegramWebhook(request, env, waitUntil);

    expect(response.status).toBe(200);
    await Promise.all(pending);

    expect(scheduledRun.runScheduledTasks).toHaveBeenCalledOnce();
    expect(telegram.sendTelegramMessageToChat.mock.calls[0]?.[2]).toContain('Run started');
    expect(telegram.sendTelegramMessageToChat.mock.calls[1]?.[2]).toContain('Run complete');
  });
});
