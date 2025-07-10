import {addDays, differenceInMinutes, format, isBefore, parse} from 'date-fns';
import {convert as htmlToText} from 'html-to-text';
import {Email} from 'postal-mime';

import {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from '../types';

/**
 * Matches ride details
 */
const LYFT_RIDE_REGEX =
  /Your Trip[\s\S]*?(?<startLocation>.+?)\s+Start\s+(?<startTime>\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s+[\s\S]*?(?<endLocation>.+?)\s+End\s+(?<endTime>\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/;

/**
 * Matches the total cost of the ride
 */
const LYFT_TOTAL_COST_REGEX = /Visa \*\d+\s+\$(?<totalCostUsd>\d+\.\d{2})/;

interface RideDetails {
  startLocation: string;
  startTime: string;
  endLocation: string;
  endTime: string;
}

interface CostDetails {
  totalCostUsd: string;
}

function process(email: Email) {
  const emailText = htmlToText(email.html!);

  const rideMatch = emailText.match(LYFT_RIDE_REGEX);
  const costMatch = emailText.match(LYFT_TOTAL_COST_REGEX);

  if (rideMatch === null) {
    throw new Error('Failed to match lyft bike ride details');
  }
  if (costMatch === null) {
    throw new Error('Failed to match lyft bike total cost');
  }

  const rideDetails = rideMatch.groups as unknown as RideDetails;
  const costDetails = costMatch.groups as unknown as CostDetails;

  const start = parse(rideDetails.startTime, 'h:mm a', new Date());
  let end = parse(rideDetails.endTime, 'h:mm a', new Date());

  if (isBefore(end, start)) {
    end = addDays(end, 1);
  }

  const formattedStart = format(start, 'HH:mm');
  const duration = differenceInMinutes(end, start);
  const {startLocation, endLocation} = rideDetails;

  const costInCents = Number(costDetails.totalCostUsd.replace('.', ''));

  const note = `${startLocation} → ${endLocation} [${formattedStart}, ${duration}m]`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'Lyft Bike',
    expectedTotal: costInCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;
  return !!from.address?.endsWith('lyftmail.com') && subject === 'Your Lyft Bike ride';
}

export const lyftBikeProcessor: EmailProcessor = {
  identifier: 'lyft-bike',
  matchEmail,
  process,
};
