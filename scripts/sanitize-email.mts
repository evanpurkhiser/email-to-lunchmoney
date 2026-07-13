#!/usr/bin/env node

/**
 * Sanitize email files for use as test fixtures by removing sensitive information
 *
 * Usage:
 *   npx tsx scripts/sanitize-email.mts <input.eml> [output.eml] [options]
 *
 * If output.eml is not specified, the input file will be overwritten.
 *
 * Options:
 *   --name "First Last"        Redact this name → Test User
 *   --address "123 Street St"  Redact this street address → 123 Test Street
 *   --city "City, ST 12345"    Redact this city/state/zip → Test City, TS 12345
 *
 * Always redacted:
 * - Email addresses → testuser@example.com
 * - Credit card last 4 digits → 1234
 * - Invoice/transaction IDs → repeated 1's
 * - Message IDs → <REDACTED@example.com>
 * - URL tokens → REDACTED_SPARAMS, REDACTED_CHECK
 *
 * Also:
 * - Filters headers to whitelist (removes tracking/auth headers)
 * - Preserves email structure for testing
 */

import {readFileSync, renameSync, writeFileSync} from 'node:fs';

const REDACTED_EMAIL = 'testuser@example.com';
const REDACTED_NAME = 'Test User';
const REDACTED_USERNAME = 'testuser';
const REDACTED_CC_LAST4 = '1234';

// Headers to keep (whitelist)
const ALLOWED_HEADERS = [
  'to',
  'from',
  'reply-to',
  'errors-to',
  'subject',
  'date',
  'mime-version',
  'content-type',
  'content-transfer-encoding',
  'message-id',
  // Vendor-specific headers that might be useful for testing
  'x-steam-message-type',
];

interface Header {
  name: string;
  value: string;
}

interface ParseResult {
  headers: Header[];
  body: string;
  lineEnding: string;
}

function parseHeaders(content: string): ParseResult {
  // Detect line ending style
  const usesWindows = content.includes('\r\n');
  const lineEnding = usesWindows ? '\r\n' : '\n';
  const headerBodySeparator = lineEnding + lineEnding;

  const headerEndIndex = content.indexOf(headerBodySeparator);
  if (headerEndIndex === -1) {
    return {headers: [], body: content, lineEnding};
  }

  const headerSection = content.substring(0, headerEndIndex);
  const body = content.substring(headerEndIndex + headerBodySeparator.length);

  const headers: Header[] = [];
  let currentHeader: Header | null = null;

  for (const line of headerSection.split(lineEnding)) {
    // Continuation of previous header (starts with whitespace)
    if (line.match(/^\s/) && currentHeader) {
      currentHeader.value += lineEnding + line;
    } else {
      // New header
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        currentHeader = {
          name: match[1],
          value: match[2],
        };
        headers.push(currentHeader);
      }
    }
  }

  return {headers, body, lineEnding};
}

function filterHeaders(headers: Header[]): Header[] {
  return headers.filter(header => {
    const normalizedName = header.name.toLowerCase();
    return ALLOWED_HEADERS.includes(normalizedName);
  });
}

/**
 * Escapes special regex characters in a string to make it safe for use in RegExp
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface SanitizeOptions {
  name?: string;
  address?: string;
  city?: string;
}

function sanitizeEmail(
  content: string,
  originalEmail: string,
  originalUsername: string,
  options: SanitizeOptions = {},
): string {
  // Parse headers and body
  const {headers, body, lineEnding} = parseHeaders(content);

  // Filter to allowed headers only
  const filteredHeaders = filterHeaders(headers);

  // Compile all regexes once at the start for better performance
  const emailRegex = new RegExp(escapeRegex(originalEmail), 'gi');
  const usernameRegex = new RegExp(escapeRegex(originalUsername), 'gi');

  // Compile optional regexes if provided
  let nameRegex: RegExp | undefined;
  if (options.name) {
    // Fix ReDoS: use \s+ instead of ' +' to safely match variable whitespace
    const escapedName = escapeRegex(options.name).replace(/\s+/g, '\\s+');
    nameRegex = new RegExp(escapedName, 'gi');
  }

  let addressRegex: RegExp | undefined;
  if (options.address) {
    const escapedAddress = escapeRegex(options.address).replace(/\s+/g, '\\s+');
    addressRegex = new RegExp(escapedAddress, 'gi');
  }

  let cityRegex: RegExp | undefined;
  if (options.city) {
    const escapedCity = escapeRegex(options.city).replace(/\s+/g, '\\s+');
    cityRegex = new RegExp(escapedCity, 'gi');
  }

  // For username with zero-width breaks in HTML
  const usernameWithBreaks = `${originalUsername.split('').join('&#8203;')}&#8203;`;
  const usernameWithBreaksRegex = new RegExp(escapeRegex(usernameWithBreaks), 'g');
  const redactedUsernameWithBreaks = `${REDACTED_USERNAME.split('').join('&#8203;')}&#8203;`;

  // Sanitize header values
  const sanitizedHeaders = filteredHeaders.map(header => {
    let value = header.value;

    // Redact email addresses and username in header
    value = value.replace(emailRegex, REDACTED_EMAIL);
    value = value.replace(usernameRegex, REDACTED_USERNAME);

    // Redact personal name if provided
    if (nameRegex) {
      value = value.replace(nameRegex, REDACTED_NAME);
    }

    // Redact Message-Id
    if (header.name.toLowerCase() === 'message-id') {
      value = value.replace(/<[^>]+>/, '<REDACTED@example.com>');
    }

    return {name: header.name, value};
  });

  // Sanitize body
  let sanitizedBody = body;

  // Redact email addresses
  sanitizedBody = sanitizedBody.replace(emailRegex, REDACTED_EMAIL);

  // Redact username (including with zero-width breaks in HTML)
  sanitizedBody = sanitizedBody.replace(
    usernameWithBreaksRegex,
    redactedUsernameWithBreaks,
  );
  sanitizedBody = sanitizedBody.replace(usernameRegex, REDACTED_USERNAME);

  // Redact invoice/transaction numbers (long numeric strings)
  sanitizedBody = sanitizedBody.replace(/\b\d{15,20}\b/g, match =>
    '1'.repeat(match.length),
  );

  // Redact personal name if provided
  if (nameRegex) {
    sanitizedBody = sanitizedBody.replace(nameRegex, REDACTED_NAME);
  }

  // Redact street address if provided
  if (addressRegex) {
    sanitizedBody = sanitizedBody.replace(addressRegex, '123 Test Street');
  }

  // Redact city/state/zip if provided
  if (cityRegex) {
    sanitizedBody = sanitizedBody.replace(cityRegex, 'Test City, TS 12345');
  }

  // Redact credit card last 4 digits
  // Matches patterns like: ending in 1234, ****1234, XXXX 1234, xxxx1234, last 4: 5678
  sanitizedBody = sanitizedBody.replace(
    /(\*{4}|[xX]{4}|\bXXXX|\bending in|\blast 4:?)\s*\d{4}\b/gi,
    `$1 ${REDACTED_CC_LAST4}`,
  );
  // Catch standalone last 4 in payment contexts (more conservative)
  sanitizedBody = sanitizedBody.replace(
    /(card|visa|mastercard|amex|discover|payment method).*?\b\d{4}\b/gi,
    match => match.replace(/\d{4}/, REDACTED_CC_LAST4),
  );

  // Redact URL tokens and query parameters (sparams, check parameters)
  sanitizedBody = sanitizedBody.replace(
    /(sparams=3D)[A-Za-z0-9_-]+/g,
    '$1REDACTED_SPARAMS',
  );
  sanitizedBody = sanitizedBody.replace(/(check=3D)[A-Fa-f0-9]+/g, '$1REDACTED_CHECK');

  // Reconstruct email using original line ending style
  const headerLines = sanitizedHeaders.map(h => `${h.name}: ${h.value}`).join(lineEnding);

  return `${headerLines}${lineEnding}${lineEnding}${sanitizedBody}`;
}

function parseArgs(args: string[]): {
  inputFile: string;
  outputFile: string;
  options: SanitizeOptions;
} {
  const options: SanitizeOptions = {};
  const files: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--name' && i + 1 < args.length) {
      options.name = args[++i];
    } else if (arg === '--address' && i + 1 < args.length) {
      options.address = args[++i];
    } else if (arg === '--city' && i + 1 < args.length) {
      options.city = args[++i];
    } else if (!arg.startsWith('--')) {
      files.push(arg);
    }
  }

  if (files.length < 1) {
    console.error(
      'Usage: npx tsx scripts/sanitize-email.mts <input.eml> [output.eml] [options]',
    );
    console.error('');
    console.error('If output.eml is not specified, the input file will be overwritten.');
    console.error('');
    console.error('Options:');
    console.error('  --name "First Last"        Redact this name');
    console.error('  --address "123 Street St"  Redact this street address');
    console.error('  --city "City, ST 12345"    Redact this city/state/zip');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/sanitize-email.mts email.eml');
    console.error(
      '  npx tsx scripts/sanitize-email.mts email.eml --name "John Doe" --address "123 Main St"',
    );
    console.error(
      '  npx tsx scripts/sanitize-email.mts original.eml output.eml --city "New York, NY 10001"',
    );
    process.exit(1);
  }

  const [inputFile, outputFile = files[0]] = files;

  return {inputFile, outputFile, options};
}

function main() {
  const args = process.argv.slice(2);
  const {inputFile, outputFile, options} = parseArgs(args);

  try {
    const content = readFileSync(inputFile, 'utf-8');

    // Extract email and username from the content (common patterns)
    // Handle both: "To: <email@example.com>" and "To: email@example.com"
    const emailMatch = content.match(/To:.*?<([^>]+@[^>]+)>|To:\s*([^\s<>]+@[^\s<>]+)/i);
    const email = emailMatch ? emailMatch[1] || emailMatch[2] : 'user@example.com';
    const username = email.split('@')[0];

    if (email === 'user@example.com') {
      console.warn(
        'Warning: Could not extract email from To: header. Some sensitive data may not be redacted.',
      );
    }

    console.log(`Sanitizing email file: ${inputFile}`);
    console.log(`  Email: ${email} → ${REDACTED_EMAIL}`);
    console.log(`  Username: ${username} → ${REDACTED_USERNAME}`);
    if (options.name) {
      console.log(`  Name: ${options.name} → ${REDACTED_NAME}`);
    }
    if (options.address) {
      console.log(`  Address: ${options.address} → 123 Test Street`);
    }
    if (options.city) {
      console.log(`  City: ${options.city} → Test City, TS 12345`);
    }

    const sanitized = sanitizeEmail(content, email, username, options);

    // Use atomic write when overwriting to prevent data loss if interrupted
    if (outputFile === inputFile) {
      const tempFile = `${outputFile}.tmp`;
      writeFileSync(tempFile, sanitized, 'utf-8');
      renameSync(tempFile, outputFile); // Atomic on POSIX systems
      console.log(`\n✓ File sanitized in place: ${outputFile}`);
    } else {
      writeFileSync(outputFile, sanitized, 'utf-8');
      console.log(`\n✓ Sanitized email written to: ${outputFile}`);
    }
    console.log(
      'Please review the output file to ensure all sensitive data has been removed.',
    );
  } catch (error) {
    if (error instanceof Error) {
      // Provide more specific error messages for common issues
      if ('code' in error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          console.error(`Error: File not found: ${inputFile}`);
        } else if (code === 'EACCES') {
          console.error(`Error: Permission denied: ${inputFile}`);
        } else {
          console.error(`Error: ${error.message}`);
        }
      } else {
        console.error(`Error: ${error.message}`);
      }
    } else {
      console.error(`Error: ${String(error)}`);
    }
    process.exit(1);
  }
}

main();
