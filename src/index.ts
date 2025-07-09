import PostalMime, {Email} from 'postal-mime';

import {isAmazonOrder, processAmazonEmail} from './amazon';
import {LunchMoneyAction} from './types';

/**
 * Records one or more LunchMoney actions to the database using a bulk insert
 */
export function recordActions(actions: LunchMoneyAction[], source: string, env: Env) {
  const stmt = env.DB.prepare(
    'INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)'
  );

  return env.DB.batch(actions.map(a => stmt.bind(source, JSON.stringify(a))));
}

async function processEmail(email: Email, env: Env) {
  console.log(`Processing email from: ${email.from.address}`);

  if (isAmazonOrder(email)) {
    const action = await processAmazonEmail(email, env);
    await recordActions([action], 'amazon', env);

    return;
  }

  console.error('Email was not handled');
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
};

export default app;
