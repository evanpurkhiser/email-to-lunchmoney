#!/usr/bin/env tsx

import PostalMime from 'postal-mime';

import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

import {DEFAULT_EMAIL_PROCESSORS} from './processors';

function usage() {
  console.error('Usage: email-to-lunchmoney test <path-to-eml-file>');
}

function makeEnv(): Env {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  } as Env;
}

async function testEmail(path: string) {
  const filePath = resolve(path);
  const rawEmail = await readFile(filePath, 'utf8');
  const email = await PostalMime.parse(rawEmail);

  console.log('email-to-lunchmoney test');
  console.log(`file: ${filePath}`);
  console.log(`from: ${email.from?.address ?? '(none)'}`);
  console.log(`subject: ${email.subject ?? '(none)'}`);
  console.log(`text bytes: ${email.text?.length ?? 0}`);
  console.log(`html bytes: ${email.html?.length ?? 0}`);

  const processors = DEFAULT_EMAIL_PROCESSORS.filter(processor =>
    processor.matchEmail(email),
  );

  if (processors.length === 0) {
    console.log('matched processors: (none)');
    process.exitCode = 2;
    return;
  }

  console.log(
    `matched processors: ${processors.map(processor => processor.identifier).join(', ')}`,
  );

  for (const processor of processors) {
    console.log(`\n[${processor.identifier}] processing`);

    try {
      const action = await processor.process(email, makeEnv());

      if (action === null) {
        console.log(`[${processor.identifier}] action: null`);
        continue;
      }

      console.log(`[${processor.identifier}] action:`);
      console.log(JSON.stringify(action, null, 2));
    } catch (error) {
      process.exitCode = 1;
      console.error(`[${processor.identifier}] failed:`);
      console.error(error);
    }
  }
}

const args = process.argv.slice(2);
if (args[0] === '--') {
  args.shift();
}

const [command, path] = args;

if (command !== 'test' || path === undefined) {
  usage();
  process.exit(1);
}

testEmail(path).catch(error => {
  console.error(error);
  process.exit(1);
});
