# Contributing

Thank you for contributing to email-to-lunchmoney! This guide will help you add new email parsers and maintain the codebase.

## Adding New Email Parsers

### 1. Create the Parser Directory

Create a new directory under `src/processors/` for your parser:

```bash
mkdir -p src/processors/vendor-name
```

### 2. Add Test Fixtures

Save example emails as `.eml` files in a `fixtures/` subdirectory:

```bash
mkdir -p src/processors/vendor-name/fixtures
```

> [!NOTE]
> It's best to start with a **real, unsanitized email** from your own inbox. This makes it much easier to develop and test your parser with actual data. You'll sanitize the fixture files later before committing (see step 7).

### 3. Implement the Parser

Create an `index.ts` file in your parser directory with the following structure:

```typescript
import {Email} from 'postal-mime';
import {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

function process(email: Email, env: Env) {
  // Parse the email and extract transaction information
  const match: LunchMoneyMatch = {
    expectedPayee: 'Vendor Name',
    expectedTotal: 1234, // Amount in cents
  };

  const updateAction: LunchMoneyUpdate = {
    type: 'update',
    match,
    note: 'Transaction description',
  };

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  return !!from?.address?.endsWith('vendor.com') && subject === 'Your receipt';
}

export const vendorEmailProcessor: EmailProcessor = {
  identifier: 'vendor',
  matchEmail,
  process,
};
```

### 4. Write Tests

Create an `index.spec.ts` file with tests for your parser:

```typescript
import {env} from 'cloudflare:test';
import PostalMime from 'postal-mime';
import {expect, test} from 'vitest';

import {vendorEmailProcessor} from '.';

const testCases = [
  {
    file: 'example',
    expected: {
      type: 'update',
      match: {expectedPayee: 'Vendor Name', expectedTotal: 1234},
      note: 'Transaction description',
    },
  },
];

test.for(testCases)('can process $file', async ({file, expected}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);

  const result = await vendorEmailProcessor.process(email, env);

  expect(result).toEqual(expected);
});

test.for(testCases)('does match $file', async ({file}) => {
  const emailFile = await import(`./fixtures/${file}.eml?raw`);
  const email = await PostalMime.parse(emailFile.default);
  expect(vendorEmailProcessor.matchEmail(email)).toBe(true);
});
```

### 5. Register the Parser

Add your parser to `src/index.ts`:

```typescript
import {vendorEmailProcessor} from 'src/processors/vendor-name';

let EMAIL_PROCESSORS: EmailProcessor[] = [
  amazonProcessor,
  lyftBikeProcessor,
  lyftRideProcessor,
  appleEmailProcessor,
  cloudflareProcessor,
  steamEmailProcessor,
  vendorEmailProcessor, // Add your processor here
];
```

### 6. Run Tests

```bash
npm test
```

### 7. Sanitize Email Fixtures

Before committing your code, sanitize the fixture emails to remove personal information using the provided script.

> [!WARNING]
> The sanitization script is a **best-effort tool**. You **must manually review** the sanitized files to ensure **no personal information** remains (names, addresses, email addresses, phone numbers, account numbers, etc.). The script cannot catch everything!

#### Usage

```bash
npx tsx scripts/sanitize-email.mts src/processors/vendor-name/fixtures/example.eml \
  --name "John Doe" \
  --address "123 Main Street" \
  --city "San Francisco, CA 94102"
```

All arguments (name, address, city) are optional. The script will:
- Remove tracking and authentication headers (keeping only essential headers)
- Replace your email address with `testuser@example.com`
- Replace your username with `testuser`
- Replace any provided name, address, or city information
- Redact credit card last 4 digits
- Redact invoice/transaction IDs
- Remove URL tokens

To sanitize multiple files:

```bash
for file in src/processors/vendor-name/fixtures/*.eml; do
  npx tsx scripts/sanitize-email.mts "$file" --name "John Doe"
done
```

After sanitizing your fixtures, **run your tests again** to ensure they still pass:

```bash
npm test
```

If tests fail after sanitization, you may need to adjust your parser to be more flexible with the sanitized data.

## Code Style

- Use TypeScript with strict type checking
- Format code with Prettier: `npx prettier --write .`
- Lint with ESLint: `npm run lint`
- Type check: `npx tsc --noEmit`

## Commit Guidelines

- Use clear, descriptive commit messages
- Keep commits focused on a single change
- Reference issues when applicable

## Questions?

If you have questions or need help, feel free to open an issue on GitHub.
