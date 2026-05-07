import {format, subDays} from 'date-fns';

import {LunchMoneyAction, LunchMoneyActionRow} from './types';

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

function getLunchMoneyTokens(env: Env): string[] {
  const multiTokenConfig = env.LUNCHMONEY_API_KEYS?.trim();

  if (multiTokenConfig) {
    return multiTokenConfig
      .split(',')
      .map(token => token.trim())
      .filter(token => token.length > 0);
  }

  const singleToken = env.LUNCHMONEY_API_KEY?.trim();
  return singleToken ? [singleToken] : [];
}

async function lunchMoneyApi(token: string, endpoint: string, options: RequestInit = {}) {
  const url = `https://dev.lunchmoney.app/v1${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
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

function matchesTransaction(action: LunchMoneyAction, txn: Record<string, any>) {
  return (
    !hasNote(txn.notes) &&
    txn.payee === action.match.expectedPayee &&
    txn.amount === (action.match.expectedTotal / 100).toFixed(4)
  );
}

function getAssignedTransactionKey(budgetAccountId: string, transactionId: number) {
  return `${budgetAccountId}-${transactionId}`;
}

async function getBudgetAccountId(token: string): Promise<string> {
  const me = await lunchMoneyApi(token, '/me') as LunchMoneyMeResponse;
  const budgetAccountId = me.budget?.account_id ?? me.account_id;

  if (budgetAccountId === undefined || budgetAccountId === null) {
    throw new Error('Lunch Money /me response did not include budget.account_id');
  }

  return `${budgetAccountId}`;
}

export async function processActions(env: Env) {
  const stmt = env.DB.prepare(
    'SELECT * FROM lunchmoney_actions ORDER BY date_created ASC',
  );
  const actionsResult = await stmt.all<LunchMoneyActionRow>();
  const actions = actionsResult.results;

  // bail if there's no pending actions to process
  if (actions.length === 0) {
    console.log('No pending actions to process');
    return;
  }

  console.log(`Got ${actions.length} pending actions`);

  const lunchMoneyTokens = getLunchMoneyTokens(env);
  if (lunchMoneyTokens.length === 0) {
    console.warn('No Lunch Money API tokens configured, skipping action processing');
    return;
  }

  console.log(`Processing actions across ${lunchMoneyTokens.length} Lunch Money token(s)`);

  const now = new Date();
  const twoWeeksAgo = subDays(now, LOOKBACK_DAYS);

  const params = new URLSearchParams({
    start_date: format(twoWeeksAgo, 'yyyy-MM-dd'),
    end_date: format(now, 'yyyy-MM-dd'),
    status: 'uncleared',
    pending: 'true',
  });

  const processedActionIds = new Set<number>();
  const assignedTransactions = new Set<string>();

  for (const token of lunchMoneyTokens) {
    if (processedActionIds.size === actions.length) {
      break;
    }

    try {
      const budgetAccountId = await getBudgetAccountId(token);
      const txnsResp = await lunchMoneyApi(
        token,
        `/transactions?${params}`,
      ) as LunchMoneyTransactionsResponse;

      console.log(`Got ${txnsResp.transactions.length} Lunch Money Transactions`, {
        budgetAccountId,
      });

      const candidateTransactions = [...txnsResp.transactions].reverse();

      for (const actionRow of actions) {
        if (processedActionIds.has(actionRow.id)) {
          continue;
        }

        const action: LunchMoneyAction = JSON.parse(actionRow.action);

        const matchingTransaction = candidateTransactions.find(txn => {
          const assignmentKey = getAssignedTransactionKey(budgetAccountId, txn.id);
          return (
            !assignedTransactions.has(assignmentKey) &&
            matchesTransaction(action, txn)
          );
        });

        if (matchingTransaction === undefined) {
          continue;
        }

        console.log(`Found matching transaction for action ${actionRow.id}`, {
          budgetAccountId,
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

            await lunchMoneyApi(token, `/transactions/${matchingTransaction.id}`, {
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

            await lunchMoneyApi(token, `/transactions/${matchingTransaction.id}`, {
              method: 'PUT',
              body: JSON.stringify({split}),
            });
          }

          assignedTransactions.add(
            getAssignedTransactionKey(budgetAccountId, matchingTransaction.id),
          );
          processedActionIds.add(actionRow.id);
          console.log(`Successfully processed action ${actionRow.id}`, {
            budgetAccountId,
            transactionId: matchingTransaction.id,
          });
        } catch (error) {
          console.error(`Failed to process action ${actionRow.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed processing Lunch Money token, continuing to next token', error);
    }
  }

  // Bulk remove processed actions
  const processedActionIdList = [...processedActionIds];
  if (processedActionIdList.length > 0) {
    const placeholders = processedActionIdList.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM lunchmoney_actions WHERE id IN (${placeholders})`)
      .bind(...processedActionIdList)
      .run();
    console.log(`Removed ${processedActionIdList.length} processed actions from database`);
  }
}
