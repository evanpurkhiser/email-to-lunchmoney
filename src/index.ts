import {
  captureException,
  consoleLoggingIntegration,
  withSentry,
} from '@sentry/cloudflare';
import {Hono} from 'hono';
import {bearerAuth} from 'hono/bearer-auth';
import type {Email} from 'postal-mime';
import PostalMime from 'postal-mime';

import {alaskaProcessor} from 'src/processors/airline-alaska';
import {americanProcessor} from 'src/processors/airline-american';
import {deltaProcessor} from 'src/processors/airline-delta';
import {southwestProcessor} from 'src/processors/airline-southwest';
import {unitedProcessor} from 'src/processors/airline-united';
import {chaseFlightsProcessor} from 'src/processors/chase-flights';
import {amazonProcessor} from 'src/processors/amazon';
import {appleEmailProcessor} from 'src/processors/apple';
import {bookingProcessor} from 'src/processors/booking';
import {cloudflareProcessor} from 'src/processors/cloudflare';
import {lyftBikeProcessor} from 'src/processors/lyft-bike';
import {lyftRideProcessor} from 'src/processors/lyft-ride';
import {steamEmailProcessor} from 'src/processors/steam';
import {uberRideProcessor} from 'src/processors/uber-ride';

import {runScheduledTasks} from './scheduled-run';
import {formatNewActionMessage, sendVerboseTelegramMessage} from './telegram';
import {handleTelegramWebhook} from './telegram-webhook';
import type {EmailProcessor, LunchMoneyAction} from './types';

let EMAIL_PROCESSORS: EmailProcessor[] = [
  // Airlines
  alaskaProcessor,
  americanProcessor,
  deltaProcessor,
  southwestProcessor,
  unitedProcessor,
  chaseFlightsProcessor,
  // Other processors
  amazonProcessor,
  bookingProcessor,
  lyftBikeProcessor,
  lyftRideProcessor,
  appleEmailProcessor,
  cloudflareProcessor,
  steamEmailProcessor,
  uberRideProcessor,
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
async function recordAction(action: LunchMoneyAction, source: string, env: Env) {
  const result = await env.DB.prepare(
    'INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)',
  )
    .bind(source, JSON.stringify(action))
    .run();

  const actionId = result.meta.last_row_id;
  await sendVerboseTelegramMessage(env, formatNewActionMessage(source, actionId, action));

  return result;
}

async function processEmail(email: Email, env: Env) {
  console.log(`Processing email from: ${email.from?.address}`);

  const processors = EMAIL_PROCESSORS.filter(processor => processor.matchEmail(email));

  if (processors.length === 0) {
    console.error(`No processor matching email from: ${email.from?.address}`);
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
 * Process a base64-encoded raw email
 */
async function processRawEmail(base64Content: string, env: Env) {
  const decodedRaw = atob(base64Content);
  const email = await PostalMime.parse(decodedRaw);
  await processEmail(email, env);
}

// Create Hono app with Env types
const app = new Hono<{Bindings: Env}>();

// Apply authentication middleware to /ingest routes
app.use(
  '/ingest',
  bearerAuth({
    verifyToken: (token, c) => token === c.env.INGEST_TOKEN,
  }),
);

/**
 * POST /ingest - Receives base64-encoded raw email content from Google Apps Script
 */
app.post('/ingest', async c => {
  // Validation: Check for body content
  const body = await c.req.text();
  if (!body || body.length === 0) {
    return c.json({error: 'Empty request body'}, 400);
  }

  // Process asynchronously and return 202 immediately
  c.executionCtx.waitUntil(processRawEmail(body, c.env));

  return c.json({message: 'Accepted'}, 202);
});

app.post('/telegram/webhook', async c => {
  return handleTelegramWebhook(c.req.raw, c.env, c.executionCtx.waitUntil.bind(c.executionCtx));
});

// Export the Hono fetch handler combined with scheduled handler
const handlers: ExportedHandler<Env> = {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(runScheduledTasks(env));
  },
};

const worker: ExportedHandler<Env> = withSentry(
  env => ({
    dsn: env.SENTRY_DSN,
    release: env.CF_VERSION_METADATA.id,
    tracesSampleRate: 1.0,
    sendDefaultPii: true,
    integrations: [consoleLoggingIntegration({levels: ['log', 'warn', 'error']})],
    enableLogs: true,
  }),
  handlers,
);

export default worker;
