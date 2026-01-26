import {addDays, differenceInMinutes, format, isBefore, parse} from 'date-fns';
import {convert as htmlToText} from 'html-to-text';
import {Email} from 'postal-mime';

import {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

/**
 * Matches ride events (pickup, stops, dropo-off)
 */
const LYFT_EVENTS_REGEX =
  /(?<label>Pickup|Drop-off|Stop)\s+(?<time>\d{1,2}:\d{2}\s*[AP]M)\s+(?<address>.+?(?=\n|$))/g;

/**
 * Matches the total cost of the ride
 */
const LYFT_TOTAL_COST_REGEX = /Visa \*\d+\s+\$(?<totalCostUsd>\d+\.\d{2})/;

interface EventDetails {
  label: string;
  time: string;
  address: string;
}

interface CostDetails {
  totalCostUsd: string;
}

function process(email: Email) {
  const emailText = htmlToText(email.html!);

  const eventMatches = [...emailText.matchAll(LYFT_EVENTS_REGEX)];
  const costMatch = emailText.match(LYFT_TOTAL_COST_REGEX);

  if (eventMatches.length === 0) {
    throw new Error('Failed to match start / stop / drop-off events');
  }
  if (costMatch === null) {
    throw new Error('Failed to match lyft ride total cost');
  }

  const events = eventMatches.map(match => {
    const {time, address} = match.groups! as unknown as EventDetails;
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

  const costDetails = costMatch.groups! as unknown as CostDetails;
  const costInCents = Number(costDetails.totalCostUsd.replace('.', ''));

  const eventPath = events.map(e => e.address).join(' → ');

  const note = `${eventPath} [${formattedStart}, ${duration}m]`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'Lyft',
    expectedTotal: costInCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  const isLyft = !!from?.address?.endsWith('lyftmail.com');

  return isLyft && !!subject?.startsWith('Your ride with');
}

export const lyftRideProcessor: EmailProcessor = {
  identifier: 'lyft-ride',
  matchEmail,
  process,
};
