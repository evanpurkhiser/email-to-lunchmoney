import {env} from 'cloudflare:test';
import {subDays} from 'date-fns';
import {beforeEach, describe, expect, it} from 'vitest';

import {cleanupNotifiedActions} from './old-action-cleanup';

describe('cleanupNotifiedActions', () => {
  function daysAgo(days: number) {
    return subDays(new Date(), days).toISOString();
  }

  async function insertAction(source: string, daysOld: number, oldEntryNotified = false) {
    const action =
      '{"type": "update", "match": {"expectedPayee": "Test", "expectedTotal": 1000}, "note": "Test"}';

    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created, old_entry_notified) VALUES (?, ?, ?, ?)'
    )
      .bind(source, action, daysAgo(daysOld), oldEntryNotified ? 1 : 0)
      .run();
  }

  async function getActionCount() {
    const {results} = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM lunchmoney_actions'
    ).all();
    return results[0].count as number;
  }

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM lunchmoney_actions').run();
  });

  it('should delete notified actions older than 30 days', async () => {
    await insertAction('test-source', 40, true);
    await cleanupNotifiedActions(env);
    expect(await getActionCount()).toBe(0);
  });

  it('should not delete notified actions less than 30 days old', async () => {
    await insertAction('test-source', 5, true);
    await cleanupNotifiedActions(env);
    expect(await getActionCount()).toBe(1);
  });

  it('should not delete actions that have not been notified', async () => {
    await insertAction('test-source', 40, false);
    await cleanupNotifiedActions(env);
    expect(await getActionCount()).toBe(1);
  });

  it('should delete multiple old notified actions', async () => {
    await insertAction('test-source-1', 40, true);
    await insertAction('test-source-2', 50, true);
    await cleanupNotifiedActions(env);
    expect(await getActionCount()).toBe(0);
  });

  it('should only delete old notified actions and keep recent or unnotified ones', async () => {
    // Old and notified - should be deleted
    await insertAction('old-notified', 40, true);

    // Recent and notified - should be kept
    await insertAction('recent-notified', 20, true);

    // Old but not notified - should be kept
    await insertAction('old-unnotified', 40, false);

    // Recent and unnotified - should be kept
    await insertAction('recent-unnotified', 3, false);

    await cleanupNotifiedActions(env);

    const {results} = await env.DB.prepare(
      'SELECT source FROM lunchmoney_actions ORDER BY source'
    ).all();

    expect(results.length).toBe(3);
    expect(results.map(r => r.source)).toEqual([
      'old-unnotified',
      'recent-notified',
      'recent-unnotified',
    ]);
  });
});
