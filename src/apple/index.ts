import {convert as htmlToText} from 'html-to-text';
import {Email} from 'postal-mime';

import {EmailProcessor, LunchMoneyMatch, LunchMoneyUpdate} from 'src/types';

const MATCHERS = [
  // Emails from iPhone purchases
  {
    testRegex: /TOTAL \$(?<totalCostUsd>\d+\.\d{2})/,
    totalCostRegex: /TOTAL \$(?<totalCostUsd>\d+\.\d{2})/,
    orderDetailsRegex:
      /ORDER ID\n(?<orderId>[A-Z0-9]+)[\s\S]*?(?=\n{2,})\n\n[^[]+\[[^\n]+\]\n(?<itemName>[^\n]+)\n(?<subItem>[^\n]+)\n/,
  },
  // Emails from Apple Store on macOS purchases
  {
    testRegex: /Apple Account:\s*\n+[^\s@]+@[^ ]+\b/,
    totalCostRegex:
      /Subtotal\s*\n\$\d+\.\d{2}\s*\nTax\s*\n\$\d+\.\d{2}[\s\S]*?-{5,}[\s\S]*?\n\$(?<totalCostUsd>\d+\.\d{2})/,
    orderDetailsRegex:
      /Order ID:\s*\n+(?<orderId>[A-Z0-9]+)[\s\S]*?Apple Account:\s*\n+[^\n]+\n+(?<itemName>[^\n]+)\n\[[^\n]+\]\n\n[^\n]+\n\n(?<subItem>[^\n]+)/,
  },
];

interface OrderDetails {
  itemName: string;
  subItem: string;
}

interface CostDetails {
  totalCostUsd: string;
}

function process(email: Email) {
  const emailText = htmlToText(email.html!);

  const matchers = MATCHERS.find(({testRegex}) => testRegex.test(emailText));

  if (matchers === undefined) {
    throw new Error('Unknown apple receipt email');
  }

  const orderMatch = emailText.match(matchers.orderDetailsRegex);
  const costMatch = emailText.match(matchers.totalCostRegex);

  if (orderMatch === null) {
    throw new Error('Failed to match Apple order details');
  }
  if (costMatch === null) {
    throw new Error('Failed to match Apple order cost details');
  }

  const orderDetails = orderMatch.groups! as unknown as OrderDetails;
  const costDetails = costMatch.groups! as unknown as CostDetails;

  const costInCents = Number(costDetails.totalCostUsd.replace('.', ''));

  const note = `${orderDetails.itemName}, ${orderDetails.subItem}`;

  const match: LunchMoneyMatch = {
    expectedPayee: 'Apple',
    expectedTotal: costInCents,
  };

  const updateAction: LunchMoneyUpdate = {type: 'update', match, note};

  return Promise.resolve(updateAction);
}

function matchEmail(email: Email) {
  const {from, subject} = email;

  return !!from?.address?.endsWith('apple.com') && subject === 'Your receipt from Apple.';
}

export const appleEmailProcessor: EmailProcessor = {
  identifier: 'apple',
  matchEmail,
  process,
};
