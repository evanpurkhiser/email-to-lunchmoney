import {env} from 'cloudflare:test';
import {subDays} from 'date-fns';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {checkOldActionEntries} from './old-actions-checker';
import * as telegram from './telegram';

describe('checkOldActionEntries', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM lunchmoney_actions').run();

    env.TELEGRAM_TOKEN = 'test_token';
    env.TELEGRAM_CHAT_ID = 'test_chat_id';

    vi.spyOn(telegram, 'sendTelegramMessage').mockResolvedValue(undefined);
  });

  it('should do nothing when no old actions exist', async () => {
    await checkOldActionEntries(env);
    expect(telegram.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('should notify about old action entries', async () => {
    const threeWeeksAgo = subDays(new Date(), 21);
    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)'
    )
      .bind(
        'test-source',
        '{"type": "update", "match": {"expectedPayee": "Test", "expectedTotal": 1000}, "note": "Test"}',
        threeWeeksAgo.toISOString()
      )
      .run();

    await checkOldActionEntries(env);

    const expectedMessage = [
      '💸 *Unprocessed email\\-to\\-lunchmoney actions*',
      '',
      'Found 1 action entries older than 15 days:',
      '',
      `*test\\-source* \\(${threeWeeksAgo.toLocaleDateString()}\\)`,
      'Update: Test \\- $10\\.00',
      'Note: Test',
      '',
      "These entries need manual attention as they haven't been processed\\.",
    ].join('\n');

    expect(telegram.sendTelegramMessage).toHaveBeenCalledOnce();
    expect(telegram.sendTelegramMessage).toHaveBeenCalledWith(env, expectedMessage);

    const {results} = await env.DB.prepare(
      'SELECT old_entry_notified FROM lunchmoney_actions WHERE source = ?'
    )
      .bind('test-source')
      .all();
    expect(results[0]).toEqual({old_entry_notified: 1}); // SQLite returns 1 for TRUE
  });

  it('should group actions by source in notification', async () => {
    const threeWeeksAgo = subDays(new Date(), 21);
    const fourWeeksAgo = subDays(new Date(), 28);

    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)'
    )
      .bind(
        'amazon',
        '{"type": "update", "match": {"expectedPayee": "Amazon", "expectedTotal": 1000}, "note": "Test"}',
        threeWeeksAgo.toISOString()
      )
      .run();

    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)'
    )
      .bind(
        'amazon',
        '{"type": "update", "match": {"expectedPayee": "Amazon", "expectedTotal": 2000}, "note": "Test 2"}',
        fourWeeksAgo.toISOString()
      )
      .run();

    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)'
    )
      .bind(
        'lyft-ride',
        '{"type": "update", "match": {"expectedPayee": "Lyft", "expectedTotal": 1500}, "note": "Ride"}',
        threeWeeksAgo.toISOString()
      )
      .run();

    await checkOldActionEntries(env);

    const expectedMessage = [
      '💸 *Unprocessed email\\-to\\-lunchmoney actions*',
      '',
      'Found 3 action entries older than 15 days:',
      '',
      `*amazon* \\(${fourWeeksAgo.toLocaleDateString()}\\)`,
      'Update: Amazon \\- $20\\.00',
      'Note: Test 2',
      '',
      `*amazon* \\(${threeWeeksAgo.toLocaleDateString()}\\)`,
      'Update: Amazon \\- $10\\.00',
      'Note: Test',
      '',
      `*lyft\\-ride* \\(${threeWeeksAgo.toLocaleDateString()}\\)`,
      'Update: Lyft \\- $15\\.00',
      'Note: Ride',
      '',
      "These entries need manual attention as they haven't been processed\\.",
    ].join('\n');

    expect(telegram.sendTelegramMessage).toHaveBeenCalledOnce();
    expect(telegram.sendTelegramMessage).toHaveBeenCalledWith(env, expectedMessage);
  });

  it('should not notify about recent actions', async () => {
    const oneWeekAgo = subDays(new Date(), 7).toISOString();
    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)'
    )
      .bind(
        'test-source',
        '{"type": "update", "match": {"expectedPayee": "Test", "expectedTotal": 1000}, "note": "Test"}',
        oneWeekAgo
      )
      .run();

    await checkOldActionEntries(env);
    expect(telegram.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('should not notify about old actions that have already been notified', async () => {
    const threeWeeksAgo = subDays(new Date(), 21).toISOString();
    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created, old_entry_notified) VALUES (?, ?, ?, TRUE)'
    )
      .bind(
        'test-source',
        '{"type": "update", "match": {"expectedPayee": "Test", "expectedTotal": 1000}, "note": "Test"}',
        threeWeeksAgo
      )
      .run();

    await checkOldActionEntries(env);
    expect(telegram.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('should escape special markdown characters in source, payee, and note', async () => {
    const threeWeeksAgo = subDays(new Date(), 21);
    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)'
    )
      .bind(
        'test_source-with*special',
        '{"type": "update", "match": {"expectedPayee": "Payee (with) [brackets]", "expectedTotal": 1000}, "note": "Note with *markdown* and _underscores_"}',
        threeWeeksAgo.toISOString()
      )
      .run();

    await checkOldActionEntries(env);

    const expectedMessage = [
      '💸 *Unprocessed email\\-to\\-lunchmoney actions*',
      '',
      'Found 1 action entries older than 15 days:',
      '',
      `*test\\_source\\-with\\*special* \\(${threeWeeksAgo.toLocaleDateString()}\\)`,
      'Update: Payee \\(with\\) \\[brackets\\] \\- $10\\.00',
      'Note: Note with \\*markdown\\* and \\_underscores\\_',
      '',
      "These entries need manual attention as they haven't been processed\\.",
    ].join('\n');

    expect(telegram.sendTelegramMessage).toHaveBeenCalledOnce();
    expect(telegram.sendTelegramMessage).toHaveBeenCalledWith(env, expectedMessage);
  });
});
