import {convert as htmlToText} from 'html-to-text';
import type {Email} from 'postal-mime';

import type {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches the confirmation number from Southwest receipts
 * Example: "Confirmation # 2CEPA9"
 */
const CONFIRMATION_REGEX = /Confirmation #\s*([A-Z0-9]{6})/;

/**
 * Matches departure and arrival airports from Southwest itineraries
 * Pattern looks for: airport code, newlines, plane icon, newlines, airport code
 * Example structure:
 *   SJC
 *
 *   [https://res.iluv.southwest.com/res/southwe_mkt_prod1/ico-plane.png]
 *
 *   SNA
 */
const ROUTE_REGEX =
  /\b([A-Z]{3})\b\s*\n\s*\n\s*\[[^\]]*ico-plane(?:_large)?\.png[^\]]*\]\s*\n\s*\n\s*\b([A-Z]{3})\b/i;

function process(email: Email) {
  if (!email.html) {
    throw new Error('Southwest itinerary email has no HTML content');
  }

  const emailText = htmlToText(email.html);

  const confirmationMatch = emailText.match(CONFIRMATION_REGEX);

  if (!confirmationMatch) {
    throw new Error('Failed to match confirmation number from Southwest receipt');
  }

  const confirmation = confirmationMatch[1];

  // Extract route using context-aware pattern matching
  // This looks for airport codes around the plane icon image
  const routeMatch = emailText.match(ROUTE_REGEX);

  if (!routeMatch) {
    throw new Error('Failed to match route from Southwest receipt');
  }

  const origin = routeMatch[1];
  const destination = routeMatch[2];

  const note = `${origin} → ${destination} (${confirmation})`;

  // Southwest itinerary emails don't include the total amount
  // Set expectedTotal to 0 to skip amount matching
  const match: LunchMoneyMatch = {
    expectedPayee: 'Southwest Airlines',
    expectedTotal: 0,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from} = email;
  // Match any email from southwest.com or subdomain (e.g., @southwest.com, @iluv.southwest.com, @ifly.southwest.com)
  const isSouthwest = Boolean(from?.address?.match(/(@|\.+)southwest\.com$/));

  return isSouthwest;
}

export const southwestProcessor: EmailProcessor = {
  identifier: 'airline-southwest',
  matchEmail,
  process,
};
