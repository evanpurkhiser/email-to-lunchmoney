import {convert as htmlToText} from 'html-to-text';
import {Email} from 'postal-mime';

import {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches the confirmation number from United receipts
 * Example: "Confirmation Number:ORCQG9"
 */
const CONFIRMATION_REGEX = /Confirmation Number:\s*(\w+)/;

/**
 * Matches flight routes in the format "City, ST, US (CODE)"
 * Example: "Newark, NJ/New York, NY, US (EWR)San Francisco, CA, US (SFO)"
 */
const ROUTE_REGEX = /\(([A-Z]{3})\).*?\(([A-Z]{3})\)/;

/**
 * Matches the total USD amount
 * Example: "Total:316.97 USD"
 */
const TOTAL_REGEX = /Total:\s*([\d,]+\.\d{2})\s*USD/g;

function process(email: Email) {
  if (!email.html) {
    throw new Error('United receipt email has no HTML content');
  }

  const emailText = htmlToText(email.html);

  const confirmationMatch = emailText.match(CONFIRMATION_REGEX);
  const routeMatch = emailText.match(ROUTE_REGEX);

  if (!confirmationMatch) {
    throw new Error('Failed to match confirmation number from United receipt');
  }
  if (!routeMatch) {
    throw new Error('Failed to match route from United receipt');
  }

  const confirmation = confirmationMatch[1];
  const origin = routeMatch[1];
  const destination = routeMatch[2];

  // Find all "Total:XXX USD" amounts and sum them
  const totals = [...emailText.matchAll(TOTAL_REGEX)];
  if (totals.length === 0) {
    throw new Error('Failed to match total from United receipt');
  }

  const totalCents = totals.reduce(
    (sum, match) => sum + Math.round(parseFloat(match[1].replace(/,/g, '')) * 100),
    0,
  );

  const note = `${origin} → ${destination} (${confirmation})`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'United Airlines',
    expectedTotal: totalCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  const isUnited = !!from?.address?.endsWith('@united.com');
  const isReceipt = !!subject?.includes('eTicket Itinerary and Receipt');

  return isUnited && isReceipt;
}

export const unitedProcessor: EmailProcessor = {
  identifier: 'airline-united',
  matchEmail,
  process,
};
