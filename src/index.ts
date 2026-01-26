import {
  captureException,
  consoleLoggingIntegration,
  withSentry,
} from '@sentry/cloudflare';
import {Hono} from 'hono';
import PostalMime, {Email} from 'postal-mime';

import {amazonProcessor} from 'src/amazon';
import {appleEmailProcessor} from 'src/apple';
import {cloudflareProcessor} from 'src/cloudflare';
import {lyftBikeProcessor} from 'src/lyft-bike';
import {lyftRideProcessor} from 'src/lyft-ride';
import {steamEmailProcessor} from 'src/steam';

import {processActions} from './lunchmoney';
import {cleanupNotifiedActions} from './old-action-cleanup';
import {checkOldActionEntries} from './old-actions-checker';
import {EmailProcessor, LunchMoneyAction} from './types';

let EMAIL_PROCESSORS: EmailProcessor[] = [
  amazonProcessor,
  lyftBikeProcessor,
  lyftRideProcessor,
  appleEmailProcessor,
  cloudflareProcessor,
  steamEmailProcessor,
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
app.use('/ingest', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({error: 'Missing or invalid Authorization header'}, 401);
  }

  const token = authHeader.replace('Bearer ', '');
  if (token !== c.env.INGEST_TOKEN) {
    return c.json({error: 'Invalid token'}, 401);
  }

  await next();

  return null;
});

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

// Export the Hono fetch handler combined with scheduled handler
const handlers: ExportedHandler<Env> = {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(processActions(env));
    ctx.waitUntil(checkOldActionEntries(env));
    ctx.waitUntil(cleanupNotifiedActions(env));
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
  handlers
);

export default worker;
