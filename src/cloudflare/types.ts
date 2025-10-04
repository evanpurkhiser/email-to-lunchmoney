/**
 * A structured representation of a Cloudflare invoice extracted from PDF text.
 */
export interface CloudflareInvoice {
  /**
   * The Cloudflare invoice number, e.g. "IN-48951432".
   */
  invoiceId: string;
  /**
   * A list of line items included in the invoice.
   */
  lineItems: CloudflareLineItem[];
  /**
   * The total amount due in cents USD.
   */
  totalCents: number;
}

/**
 * A single line item on a Cloudflare invoice.
 */
export interface CloudflareLineItem {
  /**
   * The full description of the service as shown in the invoice.
   */
  description: string;
  /**
   * A concise summary of the service for transaction notes.
   */
  shortDescription: string;
  /**
   * The quantity of this service/item.
   */
  quantity: number;
  /**
   * The total amount for this line item in cents USD.
   */
  totalCents: number;
}
