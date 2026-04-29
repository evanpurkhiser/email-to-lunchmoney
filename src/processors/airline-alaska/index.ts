import {convert as htmlToText} from 'html-to-text';
import type {Email} from 'postal-mime';

import type {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches the confirmation code from Alaska receipts
 * Example: "Confirmation code: IUZWKS"
 */
const CONFIRMATION_REGEX = /Confirmation code:\s*([A-Z0-9]{6})/;

/**
 * Matches the route from Alaska receipts
 * Format shows departure and arrival with airport codes:
 * "06:10 PM EWR Newark-Liberty Intl."
 * "09:50 PM SFO San Francisco"
 * There may be URLs and other content between departure and arrival
 */
const ROUTE_REGEX =
  /\d{2}:\d{2}\s+[AP]M\s+([A-Z]{3})\s+[\s\S]*?\d{2}:\d{2}\s+[AP]M\s+([A-Z]{3})\s+/;

/**
 * Matches the total amount
 * Example: "Total charges for air travel $386.60"
 */
const TOTAL_REGEX = /Total charges for air travel\s+\$([0-9,]+\.\d{2})/;

function process(email: Email) {
  if (!email.html) {
    throw new Error('Alaska receipt email has no HTML content');
  }

  const emailText = htmlToText(email.html);

  const confirmationMatch = emailText.match(CONFIRMATION_REGEX);
  const routeMatch = emailText.match(ROUTE_REGEX);
  const totalMatch = emailText.match(TOTAL_REGEX);

  if (!confirmationMatch) {
    throw new Error('Failed to match confirmation code from Alaska receipt');
  }
  if (!routeMatch) {
    throw new Error('Failed to match route from Alaska receipt');
  }
  if (!totalMatch) {
    throw new Error('Failed to match total from Alaska receipt');
  }

  const confirmation = confirmationMatch[1];
  const origin = routeMatch[1];
  const destination = routeMatch[2];

  const totalCents = Math.round(Number.parseFloat(totalMatch[1].replace(/,/g, '')) * 100);

  const note = `${origin} → ${destination} (${confirmation})`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'Alaska Airlines',
    expectedTotal: totalCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  const isAlaska =
    Boolean(from?.address?.endsWith('@email.alaskaair.com')) ||
    Boolean(from?.address?.endsWith('@ifly.alaskaair.com'));
  const isReceipt = Boolean(subject?.includes('Your confirmation receipt'));

  return isAlaska && isReceipt;
}

export const alaskaProcessor: EmailProcessor = {
  identifier: 'airline-alaska',
  matchEmail,
  process,
};
