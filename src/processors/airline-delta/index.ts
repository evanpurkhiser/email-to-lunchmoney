import {convert as htmlToText} from 'html-to-text';
import type {Email} from 'postal-mime';

import type {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches the confirmation number from Delta receipts
 * The confirmation appears after "Confirmation Number" with possible URL/whitespace between
 */
const CONFIRMATION_REGEX = /Confirmation Number[\s\S]*?([A-Z0-9]{6})/;
/**
 * Matches departure and arrival airport codes
 * Delta format shows city names with airport codes like:
 * "DEPART ARRIVE DELTA 670"
 * "Delta Main Classic (U)"  <- fare class line
 * "NYC-KENNEDY"
 * "05:25PM SAN FRANCISCO" or "5:15pm NYC-LAGUARDIA"
 * Note: Time can be uppercase or lowercase, and may include asterisk
 */
const ROUTE_REGEX =
  /DEPART\s+ARRIVE.*?\n.*?\n([A-Z\-\s,]+)\n\d+:\d+[ap]m\s+([A-Z\-\s,]+)\n/i;

/**
 * Matches the ticket amount in USD or CAD
 * Example: "USD TICKET AMOUNT $546.80 USD"
 */
const TOTAL_REGEX = /(?:USD|CAD)\s+TICKET AMOUNT\s+\$([0-9,]+\.\d{2})\s+(?:USD|CAD)/;

function process(email: Email) {
  if (!email.html) {
    throw new Error('Delta receipt email has no HTML content');
  }

  const emailText = htmlToText(email.html);

  // Check currency FIRST, before attempting to parse (skip CAD and other currencies)
  if (!emailText.includes('USD TICKET AMOUNT')) {
    return Promise.resolve(null);
  }

  const confirmationMatch = emailText.match(CONFIRMATION_REGEX);
  const routeMatch = emailText.match(ROUTE_REGEX);
  const totalMatch = emailText.match(TOTAL_REGEX);

  if (!confirmationMatch) {
    throw new Error('Failed to match confirmation number from Delta receipt');
  }
  if (!routeMatch) {
    throw new Error('Failed to match route from Delta receipt');
  }
  if (!totalMatch) {
    throw new Error('Failed to match total from Delta receipt');
  }

  const confirmation = confirmationMatch[1];
  const origin = routeMatch[1].trim();
  const destination = routeMatch[2].trim();

  const totalCents = Math.round(
    Number.parseFloat(totalMatch[1].replaceAll(',', '')) * 100,
  );

  const note = `${origin} → ${destination} (${confirmation})`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'Delta Air Lines',
    expectedTotal: totalCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  const isDelta = Boolean(from?.address?.endsWith('@t.delta.com'));
  const isReceipt = Boolean(subject?.includes('Your Flight Receipt'));

  return isDelta && isReceipt;
}

export const deltaProcessor: EmailProcessor = {
  identifier: 'airline-delta',
  matchEmail,
  process,
};
