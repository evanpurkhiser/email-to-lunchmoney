import {addDays, differenceInMinutes, format, isBefore, parse} from 'date-fns';
import {convert as htmlToText} from 'html-to-text';
import type {Email} from 'postal-mime';

import type {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches ride events with time and address on the same line
 * Example: "7:50 AM1-chōme-8-8 Tomigaya, Shibuya, Tokyo"
 */
const UBER_EVENTS_REGEX = /^(\d{1,2}:\d{2}\s*(?:AM|PM))(.+?)$/gm;

/**
 * Matches the total cost in USD
 * Example: "Total$36.80"
 */
const UBER_TOTAL_COST_REGEX = /^Total\s*\$(\d+(?:,\d{3})*\.\d{2})$/m;

/**
 * Matches each individual card charge in the Payments section, in the order
 * charged. A ride tipped after the fact is charged as two separate line
 * items (the fare, then the tip) rather than a single combined total.
 * Example: "American Express ••••5006$20.87"
 */
const UBER_PAYMENT_REGEX = /•{4}\d+\$(\d+(?:,\d{3})*\.\d{2})/g;

function process(email: Email) {
  const emailText = htmlToText(email.html!);

  const eventMatches = [...emailText.matchAll(UBER_EVENTS_REGEX)];

  if (eventMatches.length === 0) {
    throw new Error('Failed to match pickup / drop-off events');
  }

  // Take only first 2 matches (pickup and dropoff) - the email repeats them
  const events = eventMatches.slice(0, 2).map(match => {
    const time = match[1];
    const address = match[2].trim();
    const date = parse(time, 'h:mm a', new Date());

    return {date, address};
  });

  const start = events[0].date;
  let end = events[events.length - 1].date;

  if (isBefore(end, start)) {
    end = addDays(end, 1);
  }

  const formattedStart = format(start, 'HH:mm');
  const duration = differenceInMinutes(end, start);
  const eventPath = events.map(e => e.address).join(' → ');
  const note = `${eventPath} [${formattedStart}, ${duration}m]`;

  const paymentMatches = [...emailText.matchAll(UBER_PAYMENT_REGEX)];

  if (paymentMatches.length > 0) {
    const actions = paymentMatches.map((paymentMatch, index) => {
      const amount = paymentMatch[1].replaceAll(',', '');
      const costInCents = Math.round(Number(amount) * 100);

      const match: LunchMoneyMatch = {
        expectedPayee: 'Uber',
        expectedTotal: costInCents,
      };

      // A later payment beyond the first is a tip added after the ride,
      // charged separately from the fare
      const updateAction: LunchMoneyUpdate = {
        type: 'update',
        match,
        note: index === 0 ? note : `Tip: ${note}`,
      };

      return updateAction;
    });

    // Only wrap in an array when there's more than one charge to keep the
    // common single-charge case identical to a plain 'update' action
    return Promise.resolve(actions.length === 1 ? actions[0] : actions);
  }

  const costMatch = emailText.match(UBER_TOTAL_COST_REGEX);

  if (costMatch === null) {
    throw new Error('Failed to match uber ride total cost');
  }

  const amount = costMatch[1].replaceAll(',', '');
  const costInCents = Math.round(Number(amount) * 100);

  const match: LunchMoneyMatch = {
    expectedPayee: 'Uber',
    expectedTotal: costInCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject, html} = email;
  const isUber = Boolean(from?.address?.endsWith('uber.com'));
  const hasRideSubject = Boolean(subject?.match(/your .+ trip with uber/i));

  if (!isUber || !hasRideSubject) {
    return false;
  }

  // Exclude non-receipt emails (preliminary trip summaries)
  const emailText = htmlToText(html!);
  return !emailText.toLowerCase().includes('this is not');
}

export const uberRideProcessor: EmailProcessor = {
  identifier: 'uber-ride',
  matchEmail,
  process,
};
