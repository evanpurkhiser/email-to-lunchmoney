// Type definition for LunchMoney transaction based on the API response
export interface LunchMoneyTransaction {
  id: number;
  date: string;
  amount: string;
  currency: string;
  to_base: number;
  payee: string;
  category_id: number;
  category_name: string;
  category_group_id: number;
  category_group_name: string;
  is_income: boolean;
  exclude_from_budget: boolean;
  exclude_from_totals: boolean;
  created_at: string;
  updated_at: string;
  status: 'cleared' | 'uncleared' | 'pending';
  is_pending: boolean;
  notes: string | null;
  original_name: string | null;
  recurring_id: number | null;
  recurring_payee: string | null;
  recurring_description: string | null;
  recurring_cadence: string | null;
  recurring_type: string | null;
  recurring_amount: string | null;
  recurring_currency: string | null;
  parent_id: number | null;
  has_children: boolean;
  group_id: number | null;
  is_group: boolean;
  asset_id: number | null;
  asset_institution_name: string | null;
  asset_name: string | null;
  asset_display_name: string | null;
  asset_status: string | null;
  plaid_account_id: number | null;
  plaid_account_name: string | null;
  plaid_account_mask: string | null;
  institution_name: string | null;
  plaid_account_display_name: string | null;
  plaid_metadata: any | null;
  plaid_category: any | null;
  source: string | null;
  display_name: string | null;
  display_notes: string | null;
  account_display_name: string | null;
  tags: Array<{name: string; id: number}>;
  external_id: string | null;
}

// Helper function to create custom transactions for testing
export function createTestTransaction(
  overrides: Partial<LunchMoneyTransaction> = {}
): LunchMoneyTransaction {
  const baseTransaction: LunchMoneyTransaction = {
    id: 123,
    date: '2023-07-18',
    amount: '25.0000',
    currency: 'usd',
    to_base: 25.0,
    payee: 'Test Store',
    category_id: 456,
    category_name: 'General',
    category_group_id: 789,
    category_group_name: 'General',
    is_income: false,
    exclude_from_budget: false,
    exclude_from_totals: false,
    created_at: '2023-09-09T08:43:05.875Z',
    updated_at: '2023-10-09T06:07:03.105Z',
    status: 'uncleared',
    is_pending: true,
    notes: null,
    original_name: null,
    recurring_id: null,
    recurring_payee: null,
    recurring_description: null,
    recurring_cadence: null,
    recurring_type: null,
    recurring_amount: null,
    recurring_currency: null,
    parent_id: null,
    has_children: false,
    group_id: null,
    is_group: false,
    asset_id: null,
    asset_institution_name: null,
    asset_name: null,
    asset_display_name: null,
    asset_status: null,
    plaid_account_id: null,
    plaid_account_name: null,
    plaid_account_mask: null,
    institution_name: null,
    plaid_account_display_name: null,
    plaid_metadata: null,
    plaid_category: null,
    source: null,
    display_name: null,
    display_notes: null,
    account_display_name: null,
    tags: [],
    external_id: null,
  };

  return {...baseTransaction, ...overrides};
}

// Helper function to create a mock API response
export function createMockTransactionsResponse(transactions: LunchMoneyTransaction[]) {
  return {
    transactions,
    has_more: false,
  };
}
