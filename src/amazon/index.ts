import {Email} from 'postal-mime';

import {extractOrder} from './prompt';
import {AmazonOrderItem} from './types';

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

/**
 * Computes the tax amount for each item in an order by proportionally
 * allocating the total tax across all items based on their pre-tax cost.
 * Ensures exact distribution of tax without rounding errors by applying
 * correction to the last item.
 */
export function computeItemTaxes(items: AmazonOrderItem[], totalCost: number): number[] {
  const subtotal = items.reduce(
    (sum, item) => sum + item.priceEachUsd * item.quantity,
    0
  );

  const totalTax = totalCost - subtotal;
  if (totalTax < 0) {
    throw new Error('Total cost is less than subtotal.');
  }

  const unroundedTaxes = items.map(
    item => ((item.priceEachUsd * item.quantity) / subtotal) * totalTax
  );

  const roundedTaxes = unroundedTaxes.map((tax, i) =>
    i === unroundedTaxes.length - 1
      ? 0 // temp placeholder
      : parseFloat(tax.toFixed(2))
  );

  const sumSoFar = roundedTaxes.reduce((sum, t) => sum + t, 0);
  const lastTax = parseFloat((totalTax - sumSoFar).toFixed(2));
  roundedTaxes[roundedTaxes.length - 1] = lastTax;

  return roundedTaxes;
}

export async function processAmazonEmail(email: Email, env: Env) {
  const emailText = email.text ?? '';
  const orderText = extractOrderBlock(emailText);

  if (orderText === null) {
    console.error({orderText});
    throw new Error('Failed to extract order block from amazon email');
  }

  const order = await extractOrder(orderText, env);
  const itemTax = computeItemTaxes(order.orderItems, order.totalCostUsd);

  console.log(
    order,
    itemTax.map((tax, i) => order.orderItems[i].priceEachUsd + tax)
  );
}

export function isAmazonOrder(email: Email) {
  const {from, subject} = email;
  return from.address?.endsWith('amazon.com') && subject?.startsWith('Ordered');
}
