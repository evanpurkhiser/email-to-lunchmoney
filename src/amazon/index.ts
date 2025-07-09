import {Email} from 'postal-mime';

import {extractOrder} from './prompt';

/**
 * Extracts the main order block from an Amazon plain text email.
 * It starts at the line containing "Order #" and ends before the footer.
 */
export function extractOrderBlock(emailText: string): string | null {
  const orderStartMatch = emailText.match(/Order #\s*\n(.+?)\n/i);
  if (!orderStartMatch || orderStartMatch.index === undefined) {
    return null;
  }

  const orderStartIndex = orderStartMatch.index;
  const footerIndex = emailText.indexOf('©2025 Amazon.com');
  if (footerIndex === -1) {
    return null;
  }

  return emailText.slice(orderStartIndex, footerIndex).trim();
}

export async function processAmazonEmail(email: Email, env: Env) {
  const emailText = email.text ?? '';
  const orderText = extractOrderBlock(emailText);

  console.log(orderText);

  if (orderText === null) {
    console.error({orderText});
    throw new Error('Failed to extract order block from amazon email');
  }

  const order = await extractOrder(orderText, env);

  console.log(order);
}

export function isAmazonOrder(email: Email) {
  const {from, subject} = email;
  return from.address?.endsWith('amazon.com') && subject?.startsWith('Ordered');
}
