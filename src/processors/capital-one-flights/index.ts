import {convert as htmlToText} from 'html-to-text';
import type {Email} from 'postal-mime';

import type {EmailProcessor, LunchMoneyUpdate} from 'src/types';

import {extractFlightReceipt} from './prompt';

const FROM_ADDRESS = 'capitalone@capitalonebooking.com';
const SUBJECT_PREFIX = 'View your flight details for your';

function formatUsdFromCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function extractReceiptBlock(emailText: string): string {
  const start = emailText.indexOf('Your confirmation codes');
  const end = emailText.indexOf('Airline Fare Rules Outbound Flight');

  if (start === -1 || end === -1 || end <= start) {
    return emailText;
  }

  return emailText.slice(start, end).trim();
}

function makeNote(
  originAirportCode: string,
  destinationAirportCode: string,
  tripCode: string,
  grandTotalCents: number,
  totalDiscountCents: number,
  discountSummary: string | null,
) {
  if (totalDiscountCents <= 0 || !discountSummary) {
    return `${originAirportCode} → ${destinationAirportCode} (${tripCode})`;
  }

  return `${originAirportCode} → ${destinationAirportCode} (${tripCode}) [total $${formatUsdFromCents(grandTotalCents)}, $${formatUsdFromCents(totalDiscountCents)} ${discountSummary}]`;
}

async function process(email: Email, env: Env) {
  if (!email.html) {
    throw new Error('Capital One flight receipt email has no HTML content');
  }

  const emailText = htmlToText(email.html);
  const receiptText = extractReceiptBlock(emailText);
  const receipt = await extractFlightReceipt(receiptText, env);

  const note = makeNote(
    receipt.originAirportCode,
    receipt.destinationAirportCode,
    receipt.tripCode,
    receipt.grandTotalCents,
    receipt.totalDiscountCents,
    receipt.discountSummary,
  );

  const action: LunchMoneyUpdate = {
    type: 'update',
    match: {
      expectedPayee: 'Capital One Travel',
      expectedTotal: receipt.chargedAmountCents,
    },
    note,
  };

  return action;
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  const isCapitalOneTravel = from?.address === FROM_ADDRESS;
  const isTripDetails = Boolean(subject?.startsWith(SUBJECT_PREFIX));

  return isCapitalOneTravel && isTripDetails;
}

export const capitalOneFlightsProcessor: EmailProcessor = {
  identifier: 'capital-one-flights',
  matchEmail,
  process,
};
