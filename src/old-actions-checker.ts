import {subDays} from 'date-fns';
import {escapeMarkdown as e} from 'telegram-escape';

import {sendTelegramMessage} from './telegram';
import {LunchMoneyAction, LunchMoneyActionRow} from './types';

const OLD_ACTION_THRESHOLD_DAYS = 15;

/**
 * Generate notification message for old action entries
 */
export function formatOldActionsMessage(oldActions: LunchMoneyActionRow[]): string {
  const lines = [`💸 *${e('Unprocessed email-to-lunchmoney actions')}*`, ''];

  lines.push(
    `Found ${oldActions.length} action entries older than ${OLD_ACTION_THRESHOLD_DAYS} days:`
  );
  lines.push('');

  for (const actionRow of oldActions) {
    const action = JSON.parse(actionRow.action) as LunchMoneyAction;
    const date = new Date(actionRow.date_created).toLocaleDateString();
    const payee = action.match.expectedPayee;
    const amount = (action.match.expectedTotal / 100).toFixed(2);

    const actionLabel = action.type === 'split' ? 'Split' : 'Update';

    lines.push(
      `*${e(actionRow.source)}* ${e(`(${date})`)}`,
      `${actionLabel}: ${e(payee)} \\- ${e(`$${amount}`)}`,
      action.type === 'update'
        ? `Note: ${e(action.note)}`
        : `Splits: ${action.split.length} items`,
      ''
    );
  }

  lines.push(e("These entries need manual attention as they haven't been processed."));

  return lines.join('\n');
}

/**
 * Check for action entries older than 2 weeks and notify via Telegram
 */
export async function checkOldActionEntries(env: Env): Promise<void> {
  const thresholdAgo = subDays(new Date(), OLD_ACTION_THRESHOLD_DAYS);
  const thresholdAgoISO = thresholdAgo.toISOString();

  const stmt = env.DB.prepare(`
    SELECT * FROM lunchmoney_actions
    WHERE date_created <= ?
      AND (old_entry_notified IS NULL OR old_entry_notified = FALSE)
    ORDER BY date_created ASC
  `);

  const result = await stmt.bind(thresholdAgoISO).all<LunchMoneyActionRow>();
  const oldActions = result.results;

  if (oldActions.length === 0) {
    return;
  }

  console.log(`Found ${oldActions.length} old action entries`);

  const message = formatOldActionsMessage(oldActions);
  await sendTelegramMessage(env, message);

  // Mark all these actions as notified
  const actionIds = oldActions.map(action => action.id);
  if (actionIds.length > 0) {
    const placeholders = actionIds.map(() => '?').join(',');
    await env.DB.prepare(
      `
      UPDATE lunchmoney_actions
      SET old_entry_notified = TRUE
      WHERE id IN (${placeholders})
    `
    )
      .bind(...actionIds)
      .run();
    console.log(`Marked ${actionIds.length} actions as notified`);
  }
}
