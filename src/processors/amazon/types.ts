/**
 * A structured representation of an Amazon order extracted from an email.
 */
export interface AmazonOrder {
  /**
   * The Amazon order number, e.g. "114-9193968-9091445".
   */
  orderId: string;
  /**
   * A list of items included in the order.
   */
  orderItems: AmazonOrderItem[];
  /**
   * The total cost of the order in cents USD, found at the bottom of the email.
   */
  totalCostCents: number;
}

/**
 * A single item listed in an Amazon order.
 */
export interface AmazonOrderItem {
  /**
   * The full product title as shown in the email under “Ordered”.
   */
  name: string;
  /**
   * A concise 2–4 word summary of the item (brand + descriptor).
   */
  shortName: string;
  /**
   * The number of units ordered for this item.
   */
  quantity: number;
  /**
   * The price of a single unit in cents USD.
   */
  priceEachCents: number;
}
