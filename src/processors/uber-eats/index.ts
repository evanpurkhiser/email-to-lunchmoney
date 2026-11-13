import {addDays, differenceInMinutes, format, isBefore, parse} from 'date-fns';
import {convert as htmlToText} from 'html-to-text';
import type {Email} from 'postal-mime';

import type {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches the restaurant name from the receipt greeting line
 * Example: "Here's your receipt for Test Kitchen (Downtown)."
 */
const UBER_EATS_RESTAURANT_REGEX = /Here's your receipt for (.+)\.$/m;

/**
 * Matches the order total in USD
 * Example: "Total$42.18" (adjacent table cells render with no space between them)
 */
const UBER_EATS_TOTAL_COST_REGEX = /^Total\s*\$(\d+(?:,\d{3})*\.\d{2})$/m;

/**
 * Matches the pickup (restaurant) and delivery time/address lines
 * Example: "7:25 PM - Pickup456 Example Ave, Test City, TS 12345, US"
 */
const UBER_EATS_PICKUP_REGEX = /(\d{1,2}:\d{2}\s*(?:AM|PM)) - Pickup\s*(.+)/;
const UBER_EATS_DELIVERY_REGEX = /(\d{1,2}:\d{2}\s*(?:AM|PM)) - Delivery\s*(.+)/;

/**
 * Matches each individual card charge in the Payments section, in the order
 * charged. An order tipped after delivery is charged as two separate line
 * items (the order, then the tip) rather than a single combined total.
 * Example: "American Express ••••1234$42.18"
 */
const UBER_EATS_PAYMENT_REGEX = /•{4}\d+\$(\d+(?:,\d{3})*\.\d{2})/g;

function process(email: Email) {
  const emailText = htmlToText(email.html!);

  const restaurantMatch = emailText.match(UBER_EATS_RESTAURANT_REGEX);

  if (restaurantMatch === null) {
    throw new Error('Failed to match uber eats restaurant name');
  }

  const restaurant = restaurantMatch[1].trim();

  const pickupMatch = emailText.match(UBER_EATS_PICKUP_REGEX);
  const deliveryMatch = emailText.match(UBER_EATS_DELIVERY_REGEX);

  let note = restaurant;

  if (pickupMatch !== null && deliveryMatch !== null) {
    const start = parse(pickupMatch[1], 'h:mm a', new Date());
    let end = parse(deliveryMatch[1], 'h:mm a', new Date());

    if (isBefore(end, start)) {
      end = addDays(end, 1);
    }

    const formattedStart = format(start, 'HH:mm');
    const duration = differenceInMinutes(end, start);
    const deliveryAddress = deliveryMatch[2].trim();

    note = `${restaurant} → ${deliveryAddress} [${formattedStart}, ${duration}m]`;
  }

  const paymentMatches = [...emailText.matchAll(UBER_EATS_PAYMENT_REGEX)];

  if (paymentMatches.length > 0) {
    const actions = paymentMatches.map((paymentMatch, index) => {
      const amount = paymentMatch[1].replaceAll(',', '');
      const costInCents = Math.round(Number(amount) * 100);

      // A later payment beyond the first is a tip added after delivery,
      // charged separately from the order. Some tip charges post under
      // the payee "Uber", so tips match either name.
      const isTip = index > 0;

      const match: LunchMoneyMatch = {
        expectedPayee: 'Uber Eats',
        ...(isTip ? {alternatePayees: ['Uber']} : {}),
        expectedTotal: costInCents,
      };

      const updateAction: LunchMoneyUpdate = {
        type: 'update',
        match,
        note: isTip ? `Tip: ${note}` : note,
        payee: 'Uber Eats',
      };

      return updateAction;
    });

    // Only wrap in an array when there's more than one charge to keep the
    // common single-charge case identical to a plain 'update' action
    return Promise.resolve(actions.length === 1 ? actions[0] : actions);
  }

  const costMatch = emailText.match(UBER_EATS_TOTAL_COST_REGEX);

  if (costMatch === null) {
    throw new Error('Failed to match uber eats order total');
  }

  const amount = costMatch[1].replaceAll(',', '');
  const costInCents = Math.round(Number(amount) * 100);

  const match: LunchMoneyMatch = {
    expectedPayee: 'Uber Eats',
    expectedTotal: costInCents,
  };

  const updateAction: LunchMoneyUpdate = {
    type: 'update',
    match,
    note,
    payee: 'Uber Eats',
  };

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  const isUber = Boolean(from?.address?.endsWith('uber.com'));
  const hasOrderSubject = Boolean(subject?.match(/order with uber eats/i));

  return isUber && hasOrderSubject;
}

export const uberEatsProcessor: EmailProcessor = {
  identifier: 'uber-eats',
  matchEmail,
  process,
};
