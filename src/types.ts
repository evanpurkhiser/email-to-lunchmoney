import {Email} from 'postal-mime';

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
  process: (email: Email, env: Env) => Promise<LunchMoneyAction>;
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

export interface LunchMoneyActionRow {
  id: number;
  date_created: string;
  source: string;
  action: string;
}
