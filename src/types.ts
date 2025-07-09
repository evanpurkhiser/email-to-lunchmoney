export interface LunchMoneyMatch {
  /**
   * The name of the payee to match
   */
  expectedPayee: string;
  /**
   * The expected total to match in lunchmoney in cents
   */
  expectedTotal: number;
}

export interface LunchMoneySplit {
  type: 'split';
  /**
   * How to match the transaction in lunchmoney
   */
  match: LunchMoneyMatch;
  /**
   * How to split the transaction
   */
  split: Array<{amount: number; note: string}>;
}

export interface LunchMoneyUpdate {
  type: 'update';
  /**
   * How to match the transaction in lunchmoney
   */
  match: LunchMoneyMatch;
  /**
   * The updated note for the transaction
   */
  note: string;
}

export type LunchMoneyAction = LunchMoneyUpdate | LunchMoneySplit;
