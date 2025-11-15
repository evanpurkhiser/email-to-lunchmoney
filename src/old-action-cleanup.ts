import {subDays} from 'date-fns';

const NOTIFIED_ACTION_CLEANUP_DAYS = 30;

/**
 * Delete action entries that have been notified on and are older than the
 * cleanup threshold.
 */
export async function cleanupNotifiedActions(env: Env): Promise<void> {
  const cleanupThreshold = subDays(new Date(), NOTIFIED_ACTION_CLEANUP_DAYS);
  const cleanupThresholdISO = cleanupThreshold.toISOString();

  const stmt = env.DB.prepare(`
    DELETE FROM lunchmoney_actions WHERE old_entry_notified = TRUE AND date_created <= ?
  `);

  const result = await stmt.bind(cleanupThresholdISO).run();

  if (result.meta.changes > 0) {
    console.log(`Cleaned up ${result.meta.changes} old action entries`);
  }
}
