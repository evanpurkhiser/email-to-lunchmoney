import type {Email} from 'postal-mime';

export interface EmailProcessor {
  /**
   * String identifier for this processor.
   */
  identifier: string;
  /**
   * Determines if this processor is responsible for processing this email
   */
  matchEmail: (email: Email) => boolean;
  /**
   * Process am email.
   */
  process: (email: Email, env: Env) => Promise<LunchMoneyAction | null>;
}

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
  split: Split[];
}

interface Split {
  /**
   * Split amount in cents
   */
  amount: number;
  /**
   * Note for the split
   */
  note: string;
  /**
   * Should the split item be marked as reviewed?
   */
  markReviewed?: boolean;
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
  /**
   * Should we mark the item as reviewed?
   */
  markReviewed?: boolean;
}

export type LunchMoneyAction = LunchMoneyUpdate | LunchMoneySplit;

export interface LunchMoneyActionRow {
  id: number;
  date_created: string;
  source: string;
  action: string;
  old_entry_notified?: boolean | null;
}
