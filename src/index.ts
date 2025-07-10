import {captureException, withSentry} from '@sentry/cloudflare';
import PostalMime, {Email} from 'postal-mime';

import {amazonProcessor} from 'src/amazon';
import {lyftBikeProcessor} from 'src/lyft-bike';
import {EmailProcessor, LunchMoneyAction} from 'src/types';

import {processActions} from './lunchmoney';

let EMAIL_PROCESSORS: EmailProcessor[] = [amazonProcessor, lyftBikeProcessor];

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

  const results = processors.map(async processor => {
    try {
      const action = await processor.process(email, env);
      await recordAction(action, processor.identifier, env);
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
const emailHandler: EmailExportedHandler<Env> = async function (message, env, ctx) {
  const forwardedMessage = await PostalMime.parse(message.raw);
  const from = forwardedMessage.from.address;

  if (from !== env.ACCEPTED_EMAIL) {
    console.warn('Recieved email from disallowed address', {from});
    return;
  }

  // The Google App Script forwards the entire "raw" contents of the oirignal
  // message as plain text, so we parse the plain text portion
  const originalMessage = await PostalMime.parse(forwardedMessage.text!);

  ctx.waitUntil(processEmail(originalMessage, env));
};

const app: ExportedHandler<Env> = withSentry(
  env => ({
    dsn: 'https://67fbf2b80619df462851d411a66557be@o126623.ingest.us.sentry.io/4509642116890624',
    release: env.CF_VERSION_METADATA.id,
    tracesSampleRate: 1.0,
    sendDefaultPii: true,
  }),
  {
    email: emailHandler,
    scheduled: (_controller, env, ctx) => void ctx.waitUntil(processActions(env)),
  }
);

export default app;
