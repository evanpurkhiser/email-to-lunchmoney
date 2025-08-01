import {format, subDays} from 'date-fns';

import {LunchMoneyAction, LunchMoneyActionRow} from './types';

const LOOKBACK_DAYS = 180;

async function lunchMoneyApi(env: Env, endpoint: string, options: RequestInit = {}) {
  const url = `https://dev.lunchmoney.app/v1${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.LUNCHMONEY_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`LunchMoney API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Record<string, any>;
}

function hasNote(note: string | null) {
  return note !== null && note !== '';
}

export async function processActions(env: Env) {
  const stmt = env.DB.prepare(
    'SELECT * FROM lunchmoney_actions ORDER BY date_created DESC'
  );
  const actionsResult = await stmt.all<LunchMoneyActionRow>();
  const actions = actionsResult.results.reverse();

  // bail if there's no pending actions to process
  if (actions.length === 0) {
    console.log('No pending actions to process');
    return;
  }

  console.log(`Got ${actions.length} pending actions`);

  const now = new Date();
  const twoWeeksAgo = subDays(now, LOOKBACK_DAYS);

  const params = new URLSearchParams({
    start_date: format(twoWeeksAgo, 'yyyy-MM-dd'),
    end_date: format(now, 'yyyy-MM-dd'),
    status: 'uncleared',
    pending: 'true',
  });

  const txnsResp = await lunchMoneyApi(env, `/transactions?${params}`);

  console.log(`Got ${txnsResp.transactions.length} Lunch Money Transactions`);

  // iterate through all actions and then use transactions.find to locate a
  // transaction that has a matching payee name to what's expected in the
  // action as well as matching amount
  const processedActionIds: number[] = [];

  // track which transactions we've already assigned
  const assignedTransactions: number[] = [];

  for (const actionRow of actions) {
    const action: LunchMoneyAction = JSON.parse(actionRow.action);

    // Find matching transaction by payee name. Look for newest transactions
    // first, since we're processing actions in order of newest to oldest
    const matchingTransaction = txnsResp.transactions
      .reverse()
      .find(
        (txn: any) =>
          !assignedTransactions.includes(txn.id) &&
          !hasNote(txn.notes) &&
          txn.payee === action.match.expectedPayee &&
          txn.amount === (action.match.expectedTotal / 100).toFixed(4)
      );

    // if we can't find the transaction skip it
    if (matchingTransaction === undefined) {
      console.log(`No matching transaction found for action ${actionRow.id}`);
      continue;
    }

    console.log(`Found matching transaction for action ${actionRow.id}`, {
      matchingTransaction,
      actionRow,
    });

    // In a try catch try to process the lunch money action with the found
    // transaction. Either `update` which will just set the note, or `split`
    // which spits the transaction and sets the note from each split
    try {
      if (action.type === 'update') {
        const transaction = {
          id: matchingTransaction.id,
          notes: action.note,
        };

        await lunchMoneyApi(env, `/transactions/${matchingTransaction.id}`, {
          method: 'PUT',
          body: JSON.stringify({transaction}),
        });
      }

      if (action.type === 'split') {
        // Convert split data from our format to API format
        const split = action.split.map(item => ({
          amount: (item.amount / 100).toFixed(2),
          notes: item.note,
          category_id: matchingTransaction.category_id,
        }));

        await lunchMoneyApi(env, `/transactions/${matchingTransaction.id}`, {
          method: 'PUT',
          body: JSON.stringify({split}),
        });
      }

      assignedTransactions.push(matchingTransaction.id);

      // Record which lm action IDs have been processed so we can bulk remove them
      // from the database at the end
      processedActionIds.push(actionRow.id);
      console.log(`Successfully processed action ${actionRow.id}`);
    } catch (error) {
      console.error(`Failed to process action ${actionRow.id}:`, error);
    }
  }

  // Bulk remove processed actions
  if (processedActionIds.length > 0) {
    const placeholders = processedActionIds.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM lunchmoney_actions WHERE id IN (${placeholders})`)
      .bind(...processedActionIds)
      .run();
    console.log(`Removed ${processedActionIds.length} processed actions from database`);
  }
}
