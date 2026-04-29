import {convert as htmlToText} from 'html-to-text';
import type {Email} from 'postal-mime';

import type {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches the record locator (confirmation code) from American receipts
 * Example: "Record Locator: EIKCON"
 */
const CONFIRMATION_REGEX = /Record Locator:\s*([A-Z0-9]{6})/;

/**
 * Matches the route from the subject line
 * Example: "Your trip confirmation (SFO - SHV)"
 */
const ROUTE_REGEX = /Your trip confirmation \(([A-Z]{3})\s*-\s*([A-Z]{3})\)/;

/**
 * Matches the total paid amount
 * Example: "Total paid $128.81"
 */
const TOTAL_REGEX = /Total paid\s+\$([0-9,]+\.\d{2})/;

function process(email: Email) {
  if (!email.html) {
    throw new Error('American receipt email has no HTML content');
  }

  const emailText = htmlToText(email.html);

  const confirmationMatch = emailText.match(CONFIRMATION_REGEX);
  const routeMatch = email.subject?.match(ROUTE_REGEX);
  const totalMatch = emailText.match(TOTAL_REGEX);

  if (!confirmationMatch) {
    throw new Error('Failed to match confirmation code from American receipt');
  }
  if (!routeMatch) {
    throw new Error('Failed to match route from American receipt');
  }
  if (!totalMatch) {
    throw new Error('Failed to match total from American receipt');
  }

  const confirmation = confirmationMatch[1];
  const origin = routeMatch[1];
  const destination = routeMatch[2];

  const totalCents = Math.round(
    Number.parseFloat(totalMatch[1].replaceAll(',', '')) * 100,
  );

  const note = `${origin} → ${destination} (${confirmation})`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'American Airlines',
    expectedTotal: totalCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  const isAmerican = Boolean(from?.address?.endsWith('@info.email.aa.com'));
  const isReceipt = Boolean(subject?.includes('Your trip confirmation'));

  return isAmerican && isReceipt;
}

export const americanProcessor: EmailProcessor = {
  identifier: 'airline-american',
  matchEmail,
  process,
};
