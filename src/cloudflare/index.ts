import {getDocument} from 'pdfjs-serverless';
import {Email} from 'postal-mime';

import {
  EmailProcessor,
  LunchMoneyAction,
  LunchMoneySplit,
  LunchMoneyUpdate,
} from 'src/types';

import {extractInvoice} from './prompt';

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

async function process(email: Email, env: Env): Promise<LunchMoneyAction> {
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
  const invoice = await extractInvoice(pdfText, env);

  console.log('Got cloudflare invoice', invoice);

  if (invoice.lineItems.length === 0) {
    throw new Error('No line items found?');
  }

  const match = {
    expectedPayee: 'Cloudflare',
    expectedTotal: invoice.totalCents,
  };

  if (invoice.lineItems.length === 1) {
    const item = invoice.lineItems[0];
    const note = `${item.shortDescription} (${invoice.invoiceId})`;

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
      note: `${item.shortDescription} (${invoice.invoiceId})`,
      amount: item.totalCents,
    })),
  };

  return splitAction;
}

function matchEmail(email: Email): boolean {
  console.log(email);

  const {from, subject} = email;

  console.log(from.address, subject?.toLowerCase(), email.attachments);

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
