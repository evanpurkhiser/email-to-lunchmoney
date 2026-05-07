import {format, subDays} from 'date-fns';

import type {LunchMoneyAction, LunchMoneyActionRow} from './types';
import {
  formatMatchedActionMessage,
  formatSplitCreatedMessage,
  sendVerboseTelegramMessage,
} from './telegram';

const LOOKBACK_DAYS = 180;

interface LunchMoneyMeResponse {
  account_id?: number | string;
  budget?: {
    account_id?: number | string;
  };
}

interface LunchMoneyTransactionsResponse {
  transactions: Array<Record<string, any>>;
}

export interface ProcessActionsSummary {
  pendingActions: number;
  processedActions: number;
}

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

async function getBudgetAccountId(env: Env): Promise<string> {
  const me = await lunchMoneyApi(env, '/me') as LunchMoneyMeResponse;
  const budgetAccountId = me.budget?.account_id ?? me.account_id;

  if (budgetAccountId === undefined || budgetAccountId === null) {
    throw new Error('Lunch Money /me response did not include budget.account_id');
  }

  return `${budgetAccountId}`;
}

function hasNote(note: string | null) {
  return note !== null && note !== '';
}

export async function processActions(env: Env): Promise<ProcessActionsSummary> {
  const stmt = env.DB.prepare(
    'SELECT * FROM lunchmoney_actions ORDER BY date_created ASC',
  );
  const actionsResult = await stmt.all<LunchMoneyActionRow>();
  const actions = actionsResult.results;

  if (actions.length === 0) {
    console.log('No pending actions to process');
    return {pendingActions: 0, processedActions: 0};
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

  const txnsResp = await lunchMoneyApi(env, `/transactions?${params}`) as LunchMoneyTransactionsResponse;

  console.log(`Got ${txnsResp.transactions.length} Lunch Money Transactions`);

  const processedActionIds: number[] = [];
  const assignedTransactions: number[] = [];

  let budgetAccountId: string | null = null;

  for (const actionRow of actions) {
    const action: LunchMoneyAction = JSON.parse(actionRow.action);

    const matchingTransaction = txnsResp.transactions
      .reverse()
      .find(
        (txn: any) =>
          !assignedTransactions.includes(txn.id) &&
          !hasNote(txn.notes) &&
          txn.payee === action.match.expectedPayee &&
          txn.amount === (action.match.expectedTotal / 100).toFixed(4),
      );

    if (matchingTransaction === undefined) {
      console.log(`No matching transaction found for action ${actionRow.id}`);
      continue;
    }

    console.log(`Found matching transaction for action ${actionRow.id}`, {
      matchingTransaction,
      actionRow,
    });

    try {
      if (action.type === 'update') {
        const transaction = {
          id: matchingTransaction.id,
          notes: action.note,
          status: action.markReviewed ? 'cleared' : 'uncleared',
        };

        await lunchMoneyApi(env, `/transactions/${matchingTransaction.id}`, {
          method: 'PUT',
          body: JSON.stringify({transaction}),
        });
      }

      if (action.type === 'split') {
        const split = action.split.map(item => ({
          amount: (item.amount / 100).toFixed(2),
          notes: item.note,
          category_id: matchingTransaction.category_id,
          status: item.markReviewed ? 'cleared' : 'uncleared',
        }));

        await lunchMoneyApi(env, `/transactions/${matchingTransaction.id}`, {
          method: 'PUT',
          body: JSON.stringify({split}),
        });
      }

      assignedTransactions.push(matchingTransaction.id);
      processedActionIds.push(actionRow.id);

      if (env.VERBOSE_BOT === 'true') {
        budgetAccountId ??= await getBudgetAccountId(env);
        await sendVerboseTelegramMessage(
          env,
          formatMatchedActionMessage(
            actionRow.id,
            budgetAccountId,
            matchingTransaction.id,
            matchingTransaction.date,
            action,
          ),
        );

        if (action.type === 'split') {
          await sendVerboseTelegramMessage(
            env,
            formatSplitCreatedMessage(
              actionRow.id,
              matchingTransaction.id,
              action,
            ),
          );
        }
      }

      console.log(`Successfully processed action ${actionRow.id}`);
    } catch (error) {
      console.error(`Failed to process action ${actionRow.id}:`, error);
    }
  }

  if (processedActionIds.length > 0) {
    const placeholders = processedActionIds.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM lunchmoney_actions WHERE id IN (${placeholders})`)
      .bind(...processedActionIds)
      .run();
    console.log(`Removed ${processedActionIds.length} processed actions from database`);
  }

  return {
    pendingActions: actions.length,
    processedActions: processedActionIds.length,
  };
}
