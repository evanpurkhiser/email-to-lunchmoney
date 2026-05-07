import {escapeMarkdown as e} from 'telegram-escape';

import {LunchMoneyAction} from './types';

function formatAmount(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function isVerboseBotEnabled(env: Env): boolean {
  return env.VERBOSE_BOT === 'true';
}

export function formatActionSummary(action: LunchMoneyAction): string[] {
  if (action.type === 'update') {
    return [
      `Type: ${e('update')}`,
      `Payee: ${e(action.match.expectedPayee)}`,
      `Total: ${e(formatAmount(action.match.expectedTotal))}`,
      `Note: ${e(action.note)}`,
    ];
  }

  return [
    `Type: ${e('split')}`,
    `Payee: ${e(action.match.expectedPayee)}`,
    `Total: ${e(formatAmount(action.match.expectedTotal))}`,
    `Splits: ${action.split.length}`,
  ];
}

export function formatNewActionMessage(
  source: string,
  actionId: number | string,
  action: LunchMoneyAction,
): string {
  const lines = [
    `📥 *${e('New action recorded')}*`,
    `ID: ${e(`${actionId}`)}`,
    `Source: ${e(source)}`,
    ...formatActionSummary(action),
  ];

  return lines.join('\n');
}

export function formatMatchedActionMessage(
  actionId: number | string,
  budgetAccountId: string,
  transactionId: number,
  action: LunchMoneyAction,
): string {
  const lines = [
    `✅ *${e('Action matched')}*`,
    `Action ID: ${e(`${actionId}`)}`,
    `Budget: ${e(budgetAccountId)}`,
    `Transaction ID: ${e(`${transactionId}`)}`,
    ...formatActionSummary(action),
  ];

  return lines.join('\n');
}

/**
 * Send a message via Telegram
 */
export async function sendTelegramMessage(env: Env, message: string): Promise<void> {
  const token = env.TELEGRAM_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('Telegram credentials not configured, skipping notification');
    return;
  }

  const data = {
    text: message,
    chat_id: chatId,
    parse_mode: 'MarkdownV2',
  };

  const options: RequestInit = {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {'content-type': 'application/json'},
  };

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    options,
  );

  if (!response.ok) {
    console.error('Failed to send Telegram message:', await response.text());
  }
}

export async function sendVerboseTelegramMessage(
  env: Env,
  message: string,
): Promise<void> {
  if (!isVerboseBotEnabled(env)) {
    return;
  }

  await sendTelegramMessage(env, message);
}
