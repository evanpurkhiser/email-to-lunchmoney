import {parse, format} from 'date-fns';
import type {Email} from 'postal-mime';

import type {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches the property name between "Property name" label and "Property address" label.
 * Used in receipt emails.
 */
const RECEIPT_PROPERTY_REGEX = /Property name\s+([\s\S]+?)\s+Property address\b/;

/**
 * Matches the property name from confirmation emails.
 * Example: "Holiday Inn San Francisco ... is expecting you"
 */
const CONFIRMATION_PROPERTY_REGEX = /\[checkmark\.png\]\s+([\s\S]+?)\s+is expecting you/;

/**
 * Matches the check-in date with optional day-of-week.
 * Example: "Check-in Sunday, March 2, 2025"
 */
const RECEIPT_CHECKIN_REGEX = /Check-in\s+(?:\w+,\s+)?(\w+\s+\d{1,2},\s+\d{4})/;

/**
 * Matches the check-out date with optional day-of-week.
 * Example: "Check-out Saturday, March 8, 2025"
 */
const RECEIPT_CHECKOUT_REGEX = /Check-out\s+(?:\w+,\s+)?(\w+\s+\d{1,2},\s+\d{4})/;

/**
 * Matches the amount paid in USD format from receipt or confirmation emails.
 * Examples:
 *   "Amount paid on Feb 20, 2025\n   US$1,180.38"
 *   "Total Price\n   US$1,526.33"
 */
const RECEIPT_AMOUNT_REGEX = /(?:Amount paid on .+?|Total Price)\s+US\$\s*([\d,]+\.?\d*)/;

function process(email: Email) {
  const emailText = email.text!;

  const propertyMatch =
    emailText.match(RECEIPT_PROPERTY_REGEX) ??
    emailText.match(CONFIRMATION_PROPERTY_REGEX);
  const checkInMatch = emailText.match(RECEIPT_CHECKIN_REGEX);
  const checkOutMatch = emailText.match(RECEIPT_CHECKOUT_REGEX);
  const amountMatch = emailText.match(RECEIPT_AMOUNT_REGEX);

  // Only process USD receipts - ignore other currencies
  if (!amountMatch) {
    return Promise.resolve(null);
  }

  if (!propertyMatch) {
    throw new Error('Failed to match property name from Booking.com email');
  }
  if (!checkInMatch || !checkOutMatch) {
    throw new Error(
      'Failed to match check-in / check-out dates from Booking.com receipt',
    );
  }

  const property = propertyMatch[1].trim().replaceAll(/\s+/g, ' ');

  const checkInDate = parse(checkInMatch[1], 'MMMM d, yyyy', new Date());
  const checkOutDate = parse(checkOutMatch[1], 'MMMM d, yyyy', new Date());
  const checkInFmt = format(checkInDate, 'MMM d');
  const checkOutFmt = format(checkOutDate, 'MMM d');

  // Calculate number of nights
  const nights = Math.round(
    (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  const totalCents = Math.round(
    Number.parseFloat(amountMatch[1].replaceAll(',', '')) * 100,
  );

  const note = `${property} — ${checkInFmt}–${checkOutFmt} (${nights} night${nights !== 1 ? 's' : ''})`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'Booking.com',
    expectedTotal: totalCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  const isBookingCom = Boolean(from?.address?.endsWith('@booking.com'));
  const isReceipt = subject === 'This is your receipt';
  const isConfirmation = Boolean(subject?.match(/Your booking is confirmed at/i));

  return isBookingCom && (isReceipt || isConfirmation);
}

export const bookingProcessor: EmailProcessor = {
  identifier: 'booking',
  matchEmail,
  process,
};
