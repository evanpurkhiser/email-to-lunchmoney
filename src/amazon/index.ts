import {Email} from 'postal-mime';

import {
  LunchMoneyAction,
  LunchMoneyMatch,
  LunchMoneySplit,
  LunchMoneyUpdate,
} from '../types';

import {extractOrder} from './prompt';
import {AmazonOrder, AmazonOrderItem} from './types';

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
 * Works with cents (integers) to avoid floating-point precision issues.
 * Returns tax amounts in cents.
 */
export function computeItemTaxes(items: AmazonOrderItem[], totalCents: number): number[] {
  const subtotalCents = items.reduce(
    (sum, item) => sum + item.priceEachCents * item.quantity,
    0
  );

  const totalTaxCents = totalCents - subtotalCents;

  if (totalTaxCents < 0) {
    throw new Error('Total cost is less than subtotal.');
  }

  if (totalTaxCents === 0) {
    return items.map(() => 0);
  }

  // Calculate proportional tax for each item in cents
  const taxCents = items.map(item => {
    const itemCostCents = item.priceEachCents * item.quantity;
    return Math.round((itemCostCents / subtotalCents) * totalTaxCents);
  });

  // Adjust for rounding errors by adding/subtracting from the last item
  const calculatedTotalTax = taxCents.reduce((sum, tax) => sum + tax, 0);
  const difference = totalTaxCents - calculatedTotalTax;
  taxCents[taxCents.length - 1] += difference;

  return taxCents;
}

function makeItemNote(order: AmazonOrder, item: AmazonOrderItem) {
  return `${item.shortName} (${order.orderId})`;
}

function makeAction(order: AmazonOrder): LunchMoneyAction {
  const itemsTax = computeItemTaxes(order.orderItems, order.totalCostCents);

  const match: LunchMoneyMatch = {
    expectedPayee: 'Amazon',
    expectedTotal: order.totalCostCents,
  };

  if (order.orderItems.length > 1) {
    const splitAction: LunchMoneySplit = {
      match,
      type: 'split',
      split: order.orderItems.map((item, i) => ({
        note: makeItemNote(order, item),
        amount: item.priceEachCents + itemsTax[i],
      })),
    };

    return splitAction;
  }

  const updateAction: LunchMoneyUpdate = {
    match,
    type: 'update',
    note: makeItemNote(order, order.orderItems[0]),
  };

  return updateAction;
}

export async function processAmazonEmail(email: Email, env: Env) {
  const emailText = email.text ?? '';
  const orderText = extractOrderBlock(emailText);

  if (orderText === null) {
    console.error({orderText});
    throw new Error('Failed to extract order block from amazon email');
  }

  const order = await extractOrder(orderText, env);

  console.log('Got order details from amazon email', {order});

  const action = makeAction(order);

  console.log('Built Lunch Money action', {action});
}

export function isAmazonOrder(email: Email) {
  const {from, subject} = email;
  return from.address?.endsWith('amazon.com') && subject?.startsWith('Ordered');
}
