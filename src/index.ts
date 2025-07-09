import PostalMime, {Email} from 'postal-mime';

import {amazonProcessor} from './amazon';
import {processActions} from './lunchmoney';
import {EmailProcessor, LunchMoneyAction} from './types';

const EMAIL_PROCESSORS: EmailProcessor[] = [amazonProcessor];

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
    const action = await processor.process(email, env);
    await recordAction(action, processor.identifier, env);
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

const app: ExportedHandler<Env> = {
  email: emailHandler,
  scheduled: (_controller, env, ctx) => void ctx.waitUntil(processActions(env)),
};

export default app;
