import {addDays, differenceInMinutes, format, isBefore, parse} from 'date-fns';
import {convert as htmlToText} from 'html-to-text';
import {Email} from 'postal-mime';

import {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches ride events with time and address on the same line
 * Example: "7:50 AM1-chōme-8-8 Tomigaya, Shibuya, Tokyo"
 */
const UBER_EVENTS_REGEX = /^(\d{1,2}:\d{2}\s*(?:AM|PM))(.+?)$/gm;

/**
 * Matches the total cost in USD
 * Example: "Total$36.80"
 */
const UBER_TOTAL_COST_REGEX = /^Total\$(\d+(?:,\d{3})*\.\d{2})$/m;

function process(email: Email) {
  const emailText = htmlToText(email.html!);

  const eventMatches = [...emailText.matchAll(UBER_EVENTS_REGEX)];
  const costMatch = emailText.match(UBER_TOTAL_COST_REGEX);

  if (eventMatches.length === 0) {
    throw new Error('Failed to match pickup / drop-off events');
  }
  if (costMatch === null) {
    throw new Error('Failed to match uber ride total cost');
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

  const amount = costMatch[1].replace(/,/g, '');
  const costInCents = Math.round(Number(amount) * 100);

  const eventPath = events.map(e => e.address).join(' → ');

  const note = `${eventPath} [${formattedStart}, ${duration}m]`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'Uber',
    expectedTotal: costInCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject, html} = email;
  const isUber = !!from?.address?.endsWith('uber.com');
  const hasRideSubject = !!subject?.match(/your .+ trip with uber/i);

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
