import {getDocument} from 'pdfjs-serverless';
import {Email} from 'postal-mime';

import {EmailProcessor, LunchMoneySplit, LunchMoneyUpdate} from 'src/types';

import {extractInvoice} from './prompt';
import {CloudflareLineItem} from './types';

/**
 * Extracts text content from a PDF buffer using pdfjs-serverless
 */
async function extractPdfText(pdfBuffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocument({data: pdfBuffer}).promise;
  const pageTexts = await Promise.all(
    Array.from({length: pdf.numPages}, (_, i) => i + 1).map(async pageNum => {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      return textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
    })
  );

  return pageTexts.join('\n').trim();
}

/**
 * Creates a note for a Cloudflare line item, including quantity notation when > 1
 */
function makeItemNote(item: CloudflareLineItem, invoiceId: string): string {
  const quantityText = item.quantity > 1 ? ` [×${item.quantity}]` : '';
  return `${item.shortDescription}${quantityText} (${invoiceId})`;
}

async function process(email: Email, env: Env) {
  const pdfAttachment = email.attachments?.find(
    attachment => attachment.mimeType === 'application/pdf'
  );

  if (!pdfAttachment) {
    throw new Error('No PDF attachment found in Cloudflare email');
  }

  if (typeof pdfAttachment.content !== 'object' || !pdfAttachment.content.byteLength) {
    throw new Error('PDF attachment content is not a valid ArrayBuffer');
  }

  const pdfText = await extractPdfText(pdfAttachment.content as ArrayBuffer);
  const originalInvoice = await extractInvoice(pdfText, env);

  console.log('Got cloudflare invoice', originalInvoice);

  const invoice = {
    ...originalInvoice,
    // Some line-items may be zero
    lineItems: originalInvoice.lineItems.filter(item => item.totalCents > 0),
  };

  if (invoice.lineItems.length === 0) {
    console.info('Ignoring empty Cloudflare invoice', {invoiceId: invoice.invoiceId});
    return null;
  }

  const match = {
    expectedPayee: 'Cloudflare',
    expectedTotal: invoice.totalCents,
  };

  if (invoice.lineItems.length === 1) {
    const item = invoice.lineItems[0];
    const note = makeItemNote(item, invoice.invoiceId);

    const action: LunchMoneyUpdate = {
      type: 'update',
      match,
      note,
    };

    return action;
  }

  const splitAction: LunchMoneySplit = {
    type: 'split',
    match,
    split: invoice.lineItems.map(item => ({
      note: makeItemNote(item, invoice.invoiceId),
      amount: item.totalCents,
    })),
  };

  return splitAction;
}

function matchEmail(email: Email): boolean {
  const {from, subject} = email;

  return (
    !!from?.address?.includes('cloudflare.com') &&
    !!subject?.toLowerCase().includes('invoice') &&
    email.attachments?.some(attachment => attachment.mimeType === 'application/pdf')
  );
}

export const cloudflareProcessor: EmailProcessor = {
  identifier: 'cloudflare',
  matchEmail,
  process,
};
