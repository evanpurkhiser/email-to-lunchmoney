import {
  captureException,
  consoleLoggingIntegration,
  withSentry,
} from '@sentry/cloudflare';
import PostalMime, {Email} from 'postal-mime';

import {amazonProcessor} from 'src/amazon';
import {appleEmailProcessor} from 'src/apple';
import {cloudflareProcessor} from 'src/cloudflare';
import {lyftBikeProcessor} from 'src/lyft-bike';
import {lyftRideProcessor} from 'src/lyft-ride';

import {cleanupNotifiedActions} from './old-action-cleanup';
import {processActions} from './lunchmoney';
import {checkOldActionEntries} from './old-actions-checker';
import {EmailProcessor, LunchMoneyAction} from './types';

let EMAIL_PROCESSORS: EmailProcessor[] = [
  amazonProcessor,
  lyftBikeProcessor,
  lyftRideProcessor,
  appleEmailProcessor,
  cloudflareProcessor,
];

/**
 * Used in tests. replaces all email processors
 */
export function overrideProcessors(processors: EmailProcessor[]) {
  EMAIL_PROCESSORS = processors;
}

/**
 * Records a LunchMoney actions to the database
 */
function recordAction(action: LunchMoneyAction, source: string, env: Env) {
  return env.DB.prepare('INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)')
    .bind(source, JSON.stringify(action))
    .run();
}

async function processEmail(email: Email, env: Env) {
  console.log(`Processing email from: ${email.from.address}`);

  const processors = EMAIL_PROCESSORS.filter(processor => processor.matchEmail(email));

  if (processors.length === 0) {
    console.error(`No processor matching email from: ${email.from.address}`);
  }

  const results = processors.map(async processor => {
    try {
      const action = await processor.process(email, env);
      if (action !== null) {
        await recordAction(action, processor.identifier, env);
      }
    } catch (error) {
      captureException(error);
      console.error('Failed to process email', error);
    }
  });

  await Promise.all(results);
}

/**
 * This script receives emails forwarded from my gmail and recordes details
 * about expected transactions that will appear in my lunchmoney.
 */
async function handleMessage(message: ForwardableEmailMessage, env: Env) {
  const forwardedMessage = await PostalMime.parse(message.raw);
  const from = forwardedMessage.from.address;

  if (from !== env.ACCEPTED_EMAIL) {
    console.warn('Recieved email from disallowed address', {from});
    return;
  }

  console.log('raw email length', forwardedMessage.text?.length);
  console.log('raw email text', forwardedMessage.text);

  // The Google App Script forwards the entire "raw" contents of the original
  // message as base64-encoded text to avoid line wrapping issues
  const decodedRaw = atob(forwardedMessage.text!);
  const originalMessage = await PostalMime.parse(decodedRaw);

  await processEmail(originalMessage, env);
}

const app: ExportedHandler<Env> = withSentry(
  env => ({
    dsn: 'https://67fbf2b80619df462851d411a66557be@o126623.ingest.us.sentry.io/4509642116890624',
    release: env.CF_VERSION_METADATA.id,
    tracesSampleRate: 1.0,
    sendDefaultPii: true,
    integrations: [consoleLoggingIntegration({levels: ['log', 'warn', 'error']})],
    enableLogs: true,
  }),
  {
    email: (message, env, ctx) => void ctx.waitUntil(handleMessage(message, env)),
    scheduled: (_controller, env, ctx) => {
      ctx.waitUntil(processActions(env));
      ctx.waitUntil(checkOldActionEntries(env));
      ctx.waitUntil(cleanupNotifiedActions(env));
    },
  }
);

export default app;
