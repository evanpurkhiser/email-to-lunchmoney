import {convert as htmlToText} from 'html-to-text';
import {Email} from 'postal-mime';

import {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

const CONFIRMATION_REGEX = /Airline confirmation:\s*([A-Z0-9]{6})/i;
const AIRPORT_CODE_REGEX = /\(([A-Z]{3})\)/g;
const ORIGINAL_PRICE_REGEX = /Flight[\s\S]*?\$([0-9,]+\.\d{2})/i;
const TRIP_TOTAL_REGEX = /Trip total[\s\S]*?\$([0-9,]+\.\d{2})/i;
const POINTS_REDEEMED_REGEX = /Points redeemed[\s\S]*?([0-9,]+)\s*(?:pts|points)/i;
const BILLED_TO_CARD_REGEX = /Billed to card[\s\S]*?\$([0-9,]+\.\d{2})/i;

function parseUsdToCents(value: string) {
  return Math.round(parseFloat(value.replace(/,/g, '')) * 100);
}

function formatUsdFromCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function process(email: Email) {
  if (!email.html) {
    throw new Error('Chase flights receipt email has no HTML content');
  }

  const emailText = htmlToText(email.html);

  // 100% points redemptions should not create Lunch Money updates.
  const billedToCardMatch = emailText.match(BILLED_TO_CARD_REGEX);
  if (!billedToCardMatch) {
    return Promise.resolve(null);
  }

  const confirmationMatch = emailText.match(CONFIRMATION_REGEX);
  const originalPriceMatch = emailText.match(ORIGINAL_PRICE_REGEX);
  const tripTotalMatch = emailText.match(TRIP_TOTAL_REGEX);
  const pointsRedeemedMatch = emailText.match(POINTS_REDEEMED_REGEX);

  if (!confirmationMatch) {
    throw new Error('Failed to match confirmation number from Chase receipt');
  }
  if (!originalPriceMatch && !tripTotalMatch) {
    throw new Error('Failed to match original price from Chase receipt');
  }
  if (!pointsRedeemedMatch) {
    throw new Error('Failed to match points redeemed from Chase receipt');
  }

  const confirmationIndex = emailText.indexOf(confirmationMatch[0]);
  const airportCodes = [
    ...emailText.slice(Math.max(0, confirmationIndex)).matchAll(AIRPORT_CODE_REGEX),
  ].map(match => match[1]);

  if (airportCodes.length < 2) {
    throw new Error('Failed to match route from Chase receipt');
  }

  const origin = airportCodes[0];
  const destination = airportCodes[1];

  const originalPriceValue = originalPriceMatch?.[1] ?? tripTotalMatch?.[1];
  if (!originalPriceValue) {
    throw new Error('Failed to match original price from Chase receipt');
  }

  const originalPriceCents = parseUsdToCents(originalPriceValue);
  const billedToCardCents = parseUsdToCents(billedToCardMatch[1]);
  const pointsRedeemed = pointsRedeemedMatch[1];
  const discountPercent = Math.round(
    ((originalPriceCents - billedToCardCents) / originalPriceCents) * 100,
  );
  const originalPriceDisplay = formatUsdFromCents(originalPriceCents);

  const note = `${origin} → ${destination} (${confirmationMatch[1]}) [used ${pointsRedeemed} pts, ${discountPercent}% discount, originally $${originalPriceDisplay}]`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'CL * Chase Travel',
    expectedTotal: billedToCardCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  const isChaseTravel = from?.address === 'donotreply@chasetravel.com';
  const isTripConfirmation = !!subject?.startsWith('Travel Reservation Center Trip ID #');

  return isChaseTravel && isTripConfirmation;
}

export const chaseFlightsProcessor: EmailProcessor = {
  identifier: 'chase-flights',
  matchEmail,
  process,
};
