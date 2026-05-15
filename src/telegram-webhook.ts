import {escapeMarkdown as e} from 'telegram-escape';

import {ScheduledRunSummary, runScheduledTasks} from './scheduled-run';
import {sendTelegramMessageToChat} from './telegram';
import {LunchMoneyAction, LunchMoneyActionRow} from './types';

const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const RECENT_PENDING_LIMIT = 10;

interface TelegramChat {
  id: number | string;
}

interface TelegramMessage {
  chat: TelegramChat;
  text?: string;
}

interface TelegramUpdate {
  message?: TelegramMessage;
}

function isAuthorizedChat(env: Env, chatId: string): boolean {
  return env.TELEGRAM_CHAT_ID !== undefined && env.TELEGRAM_CHAT_ID === chatId;
}

export function hasValidTelegramWebhookSecret(request: Request, env: Env): boolean {
  const configuredSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!configuredSecret) {
    return false;
  }

  const headerSecret = request.headers.get(TELEGRAM_SECRET_HEADER);
  if (headerSecret === configuredSecret) {
    return true;
  }

  const url = new URL(request.url);
  return url.searchParams.get('secret') === configuredSecret;
}

function normalizeTelegramCommand(text: string | undefined): string | null {
  if (!text) {
    return null;
  }

  const [firstToken] = text.trim().split(/\s+/, 1);
  if (!firstToken?.startsWith('/')) {
    return null;
  }

  return firstToken.slice(1).split('@', 1)[0]?.toLowerCase() ?? null;
}

function formatActionType(action: LunchMoneyAction): string {
  if (action.type === 'update') {
    return `Update: ${e(action.note)}`;
  }

  return `Split: ${action.split.length} items`;
}

export function formatPendingActionsMessage(actionRows: LunchMoneyActionRow[]): string {
  if (actionRows.length === 0) {
    return `🗂 *${e('Pending actions')}*\n\n${e('No pending actions found.')}`;
  }

  const lines = [
    `🗂 *${e('Pending actions')}*`,
    '',
    `Showing ${actionRows.length} most recent entries:`,
    '',
  ];

  for (const actionRow of actionRows) {
    const action = JSON.parse(actionRow.action) as LunchMoneyAction;
    const amount = `$${(action.match.expectedTotal / 100).toFixed(2)}`;

    lines.push(
      `\\#${actionRow.id} ${e(actionRow.source)} ${e(`(${actionRow.date_created})`)}`,
      `${e(action.match.expectedPayee)} \\- ${e(amount)}`,
      formatActionType(action),
      '',
    );
  }

  return lines.join('\n');
}

export function formatRunNowStartedMessage(): string {
  return `▶️ *${e('Run started')}*\n\n${e('Starting the full scheduled workflow now.')}`;
}

export function formatRunNowCompletedMessage(summary: ScheduledRunSummary): string {
  return [
    `✅ *${e('Run complete')}*`,
    '',
    `Pending actions checked: ${summary.pendingActions}`,
    `Actions processed: ${summary.processedActions}`,
    `Old action alerts sent: ${summary.oldActionsNotified}`,
    `Notified actions cleaned up: ${summary.cleanedUpActions}`,
  ].join('\n');
}

export function formatRunNowFailedMessage(): string {
  return `⚠️ *${e('Run failed')}*\n\n${e('Check the worker logs for details.')}`;
}

async function fetchRecentPendingActions(env: Env): Promise<LunchMoneyActionRow[]> {
  const result = await env.DB.prepare(`
    SELECT *
    FROM lunchmoney_actions
    ORDER BY date_created DESC
    LIMIT ?
  `)
    .bind(RECENT_PENDING_LIMIT)
    .all<LunchMoneyActionRow>();

  return result.results;
}

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  waitUntil: ExecutionContext['waitUntil'],
): Promise<Response> {
  if (!hasValidTelegramWebhookSecret(request, env)) {
    return new Response('Unauthorized', {status: 401});
  }

  const update = await request.json<TelegramUpdate>();
  const message = update.message;

  if (!message?.chat?.id) {
    return new Response('Ignored', {status: 200});
  }

  const chatId = `${message.chat.id}`;
  if (!isAuthorizedChat(env, chatId)) {
    return new Response('Forbidden', {status: 403});
  }

  const command = normalizeTelegramCommand(message.text);

  if (command === 'show_db') {
    const actions = await fetchRecentPendingActions(env);
    await sendTelegramMessageToChat(env, chatId, formatPendingActionsMessage(actions));
    return new Response('OK', {status: 200});
  }

  if (command === 'run_now') {
    await sendTelegramMessageToChat(env, chatId, formatRunNowStartedMessage());

    waitUntil((async () => {
      try {
        const summary = await runScheduledTasks(env);
        await sendTelegramMessageToChat(
          env,
          chatId,
          formatRunNowCompletedMessage(summary),
        );
      } catch (error) {
        console.error('Failed running scheduled tasks from Telegram command', error);
        await sendTelegramMessageToChat(env, chatId, formatRunNowFailedMessage());
      }
    })());

    return new Response('OK', {status: 200});
  }

  return new Response('Ignored', {status: 200});
}
