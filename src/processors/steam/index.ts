import {convert as htmlToText} from 'html-to-text';
import {Email} from 'postal-mime';

import {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

function process(email: Email) {
  const emailText = htmlToText(email.html!);

  // Extract game name - appears after the image link
  // Pattern: [image link]\n\nGame Name\n
  const gameNameMatch = emailText.match(/\[https:\/\/[^\]]+\]\n\n([^\n]+)\n/);
  if (!gameNameMatch) {
    throw new Error('Failed to match Steam game name');
  }

  const gameName = gameNameMatch[1].trim();

  // Extract total - looks for "Total: $XX.XX"
  const totalMatch = emailText.match(/Total:\s*\$(\d+\.\d{2})/);
  if (!totalMatch) {
    throw new Error('Failed to match Steam total price');
  }

  const totalCostUsd = totalMatch[1];
  const costInCents = Number(totalCostUsd.replace('.', ''));

  const match: LunchMoneyMatch = {
    expectedPayee: 'Steam',
    expectedTotal: costInCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note: gameName};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;

  return (
    !!from?.address?.endsWith('steampowered.com') &&
    subject === 'Thank you for your Steam purchase!'
  );
}

export const steamEmailProcessor: EmailProcessor = {
  identifier: 'steam',
  matchEmail,
  process,
};
