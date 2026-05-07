import {env, fetchMock} from 'cloudflare:test';
import {afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {vi} from 'vitest';

import {
  createMockTransactionsResponse,
  createTestTransaction,
} from './fixtures/lunchmoney-transactions';
import {processActions} from './lunchmoney';
import * as telegram from './telegram';
import type {LunchMoneyAction, LunchMoneyActionRow} from './types';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

// Ensure we matched every mock we defined
afterEach(() => fetchMock.assertNoPendingInterceptors);

function getAllTransactions() {
  return env.DB.prepare('SELECT * FROM lunchmoney_actions').all<LunchMoneyActionRow>();
}

describe('processActions', () => {
  beforeEach(async () => {
    // Clear the database before each test
    await env.DB.prepare('DELETE FROM lunchmoney_actions').run();
    env.LUNCHMONEY_API_KEY = 'test-token';
    env.VERBOSE_BOT = undefined;
    vi.restoreAllMocks();
  });

  const transactionsListPath = /\/v1\/transactions\?.*/;

  it('processes no actions when database is empty', async () => {
    await processActions(env);

    // No mocked lunchmonye request, undici fetchMock will error if it does
    // attempt to call the lunchmoney API.
  });

  it('processes a single update action successfully', async () => {
    // Insert a test action into the database
    const action: LunchMoneyAction = {
      type: 'update',
      match: {
        expectedPayee: 'Amazon.com',
        expectedTotal: 2500,
      },
      note: 'Amazon purchase - electronics',
    };

    await env.DB.prepare('INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)')
      .bind('test', JSON.stringify(action))
      .run();

    // Mock the matching LunchMoney API responses
    const mockTransactions = [
      createTestTransaction({
        id: 123,
        payee: 'Amazon.com',
        amount: '25.0000',
        notes: null,
        category_id: 456,
      }),
    ];

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: transactionsListPath})
      .reply(200, createMockTransactionsResponse(mockTransactions))
      .times(1);

    const expectedUpdateBody = JSON.stringify({
      transaction: {id: 123, notes: action.note, status: 'uncleared'},
    });

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({
        path: '/v1/transactions/123',
        method: 'PUT',
        body: expectedUpdateBody,
      })
      .reply(200, {success: true});

    await processActions(env);

    // Verify the action was processed and removed from database
    const remainingActions = await getAllTransactions();
    expect(remainingActions.results).toHaveLength(0);
  });

  it('processes a single split action successfully', async () => {
    // Insert a test split action into the database
    const action: LunchMoneyAction = {
      type: 'split',
      match: {
        expectedPayee: 'Uber',
        expectedTotal: 3500, // $35.00 in cents
      },
      split: [
        {amount: 2000, note: 'Ride fare'},
        {amount: 1500, note: 'Tip'},
      ],
    };

    await env.DB.prepare('INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)')
      .bind('test', JSON.stringify(action))
      .run();

    // Mock the LunchMoney API responses
    const mockTransactions = [
      createTestTransaction({
        id: 789,
        payee: 'Uber',
        amount: '35.0000',
        notes: null,
        category_id: 101,
      }),
    ];

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({
        path: transactionsListPath,
      })
      .reply(200, createMockTransactionsResponse(mockTransactions));

    const expectedUpdateBody = JSON.stringify({
      split: [
        {amount: '20.00', notes: 'Ride fare', category_id: 101, status: 'uncleared'},
        {amount: '15.00', notes: 'Tip', category_id: 101, status: 'uncleared'},
      ],
    });

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({
        path: '/v1/transactions/789',
        method: 'PUT',
        body: expectedUpdateBody,
      })
      .reply(200, {success: true});

    await processActions(env);

    // Verify the action was processed and removed from database
    const remainingActions = await getAllTransactions();
    expect(remainingActions.results).toHaveLength(0);
  });

  it('skips actions when no matching transaction is found', async () => {
    const action: LunchMoneyAction = {
      type: 'update',
      match: {
        expectedPayee: 'NonExistent Store',
        expectedTotal: 1000,
      },
      note: 'This should not be processed',
    };

    await env.DB.prepare('INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)')
      .bind('test', JSON.stringify(action))
      .run();

    const mockTransactions = [
      createTestTransaction({
        id: 999,
        payee: 'Different Store',
        amount: '15.0000',
        notes: null,
        category_id: 888,
      }),
    ];

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: transactionsListPath})
      .reply(200, createMockTransactionsResponse(mockTransactions));

    await processActions(env);

    // Verify the action remains in the database since it wasn't processed
    const remainingActions = await getAllTransactions();
    expect(remainingActions.results).toHaveLength(1);
  });

  it('processes multiple actions in order', async () => {
    // Insert multiple test actions with different creation dates
    const actions: LunchMoneyAction[] = [
      {
        type: 'update',
        match: {expectedPayee: 'Same Store', expectedTotal: 1000},
        note: 'First action - should match oldest transaction',
      },
      {
        type: 'update',
        match: {expectedPayee: 'Same Store', expectedTotal: 1000},
        note: 'Second action - should match newer transaction',
      },
    ];

    // Insert actions with different creation dates to test chronological ordering
    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)',
    )
      .bind('test', JSON.stringify(actions[0]), '2025-01-01 10:00:00')
      .run();

    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)',
    )
      .bind('test', JSON.stringify(actions[1]), '2025-01-02 10:00:00')
      .run();

    // Mock the LunchMoney API responses with transactions in reverse chronological order
    // (newest first, as the API would return them)
    const mockTransactions = [
      createTestTransaction({
        id: 333,
        payee: 'Same Store',
        amount: '10.0000',
        notes: null,
        category_id: 444,
        date: '2025-01-15', // Newer transaction
      }),
      createTestTransaction({
        id: 111,
        payee: 'Same Store',
        amount: '10.0000',
        notes: null,
        category_id: 222,
        date: '2025-01-10', // Older transaction
      }),
    ];

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: transactionsListPath})
      .reply(200, createMockTransactionsResponse(mockTransactions));

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: '/v1/transactions/111', method: 'PUT'})
      .reply(200, {success: true});

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: '/v1/transactions/333', method: 'PUT'})
      .reply(200, {success: true});

    await processActions(env);

    // Verify all actions were processed and removed
    const remainingActions = await getAllTransactions();
    expect(remainingActions.results).toHaveLength(0);

    // The key test: verify that the first action (oldest) matched the oldest transaction (id: 111)
    // and the second action (newer) matched the newer transaction (id: 333)
    // This tests that actions are processed in chronological order
  });

  it('skips transactions that already have notes', async () => {
    const action: LunchMoneyAction = {
      type: 'update',
      match: {
        expectedPayee: 'Store with Notes',
        expectedTotal: 2000,
      },
      note: 'This should not be processed',
    };

    await env.DB.prepare('INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)')
      .bind('test', JSON.stringify(action))
      .run();

    const mockTransactions = [
      createTestTransaction({
        id: 555,
        payee: 'Store with Notes',
        amount: '20.0000',
        notes: 'Already processed',
        category_id: 666,
      }),
    ];

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: transactionsListPath})
      .reply(200, createMockTransactionsResponse(mockTransactions));

    await processActions(env);

    // Verify the action remains in the database since it wasn't processed
    const remainingActions = await getAllTransactions();
    expect(remainingActions.results).toHaveLength(1);
  });

  it('skips transactions that have already been assigned to other actions', async () => {
    const actions: LunchMoneyAction[] = [
      {
        type: 'update',
        match: {expectedPayee: 'Same Store', expectedTotal: 1000},
        note: 'First action',
      },
      {
        type: 'update',
        match: {expectedPayee: 'Same Store', expectedTotal: 1000},
        note: 'Second action - should not match same transaction',
      },
    ];

    for (const action of actions) {
      await env.DB.prepare(
        'INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)',
      )
        .bind('test', JSON.stringify(action))
        .run();
    }

    // Mock the LunchMoney API response with only one matching transaction
    const mockTransactions = [
      createTestTransaction({
        id: 777,
        payee: 'Same Store',
        amount: '10.0000',
        notes: null,
        category_id: 888,
      }),
    ];

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: transactionsListPath})
      .reply(200, createMockTransactionsResponse(mockTransactions));

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: '/v1/transactions/777', method: 'PUT'})
      .reply(200, {success: true});

    await processActions(env);

    // Verify only the first action was processed
    const remainingActions = await getAllTransactions();
    expect(remainingActions.results).toHaveLength(1);

    // Verify the remaining action is the second one
    const remainingAction = JSON.parse(
      remainingActions.results[0].action,
    ) as LunchMoneyAction;

    expect(remainingAction.type).toBe('update');
    expect(remainingAction.type === 'update' && remainingAction.note).toBe(
      'Second action - should not match same transaction',
    );
  });

  it('marks update transaction as cleared when markReviewed is true', async () => {
    const action: LunchMoneyAction = {
      type: 'update',
      match: {
        expectedPayee: 'Amazon.com',
        expectedTotal: 2500,
      },
      note: 'Amazon purchase - electronics',
      markReviewed: true,
    };

    await env.DB.prepare('INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)')
      .bind('test', JSON.stringify(action))
      .run();

    const mockTransactions = [
      createTestTransaction({
        id: 123,
        payee: 'Amazon.com',
        amount: '25.0000',
        notes: null,
        category_id: 456,
      }),
    ];

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: transactionsListPath})
      .reply(200, createMockTransactionsResponse(mockTransactions));

    const expectedUpdateBody = JSON.stringify({
      transaction: {
        id: 123,
        notes: action.note,
        status: 'cleared',
      },
    });

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({
        path: '/v1/transactions/123',
        method: 'PUT',
        body: expectedUpdateBody,
      })
      .reply(200, {success: true});

    await processActions(env);

    const remainingActions = await getAllTransactions();
    expect(remainingActions.results).toHaveLength(0);
  });

  it('marks split items as cleared/uncleared based on markReviewed flag', async () => {
    const action: LunchMoneyAction = {
      type: 'split',
      match: {
        expectedPayee: 'Uber',
        expectedTotal: 3500,
      },
      split: [
        {amount: 2000, note: 'Ride fare', markReviewed: true},
        {amount: 1500, note: 'Tip', markReviewed: false},
      ],
    };

    await env.DB.prepare('INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)')
      .bind('test', JSON.stringify(action))
      .run();

    const mockTransactions = [
      createTestTransaction({
        id: 789,
        payee: 'Uber',
        amount: '35.0000',
        notes: null,
        category_id: 101,
      }),
    ];

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: transactionsListPath})
      .reply(200, createMockTransactionsResponse(mockTransactions));

    const expectedUpdateBody = JSON.stringify({
      split: [
        {amount: '20.00', notes: 'Ride fare', category_id: 101, status: 'cleared'},
        {amount: '15.00', notes: 'Tip', category_id: 101, status: 'uncleared'},
      ],
    });

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({
        path: '/v1/transactions/789',
        method: 'PUT',
        body: expectedUpdateBody,
      })
      .reply(200, {success: true});

    await processActions(env);

    const remainingActions = await getAllTransactions();
    expect(remainingActions.results).toHaveLength(0);
  });
  it('sends a verbose telegram message when an action is matched', async () => {
    env.VERBOSE_BOT = 'true';
    vi.spyOn(telegram, 'sendVerboseTelegramMessage').mockResolvedValue(undefined);

    const action: LunchMoneyAction = {
      type: 'update',
      match: {
        expectedPayee: 'Amazon.com',
        expectedTotal: 2500,
      },
      note: 'Amazon purchase - electronics',
    };

    await env.DB.prepare('INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)')
      .bind('test', JSON.stringify(action))
      .run();

    const mockTransactions = [
      createTestTransaction({
        id: 123,
        payee: 'Amazon.com',
        amount: '25.0000',
        notes: null,
        category_id: 456,
      }),
    ];

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: '/v1/me'})
      .reply(200, {budget: {account_id: 1}})
      .times(1);

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: transactionsListPath})
      .reply(200, createMockTransactionsResponse(mockTransactions))
      .times(1);

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({
        path: '/v1/transactions/123',
        method: 'PUT',
        body: JSON.stringify({
          transaction: {id: 123, notes: action.note, status: 'uncleared'},
        }),
    })
      .reply(200, {success: true});

    await processActions(env);

    expect(telegram.sendVerboseTelegramMessage).toHaveBeenCalledOnce();
    expect(telegram.sendVerboseTelegramMessage).toHaveBeenCalledWith(
      env,
      expect.stringContaining('Transaction Matched'),
    );
    expect(telegram.sendVerboseTelegramMessage).toHaveBeenCalledWith(
      env,
      expect.stringContaining('Date: 2023\\-07\\-18'),
    );
  });

  it('sends split detail messages for split actions', async () => {
    env.VERBOSE_BOT = 'true';
    vi.spyOn(telegram, 'sendVerboseTelegramMessage').mockResolvedValue(undefined);

    const action: LunchMoneyAction = {
      type: 'split',
      match: {
        expectedPayee: 'Amazon',
        expectedTotal: 3018,
      },
      split: [
        {amount: 1484, note: 'Secret Clinical Strength Deodorant'},
        {amount: 1534, note: 'Amazon Basics Toilet Paper'},
      ],
    };

    await env.DB.prepare('INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)')
      .bind('test', JSON.stringify(action))
      .run();

    const mockTransactions = [
      createTestTransaction({
        id: 2391587215,
        payee: 'Amazon',
        amount: '30.1800',
        notes: null,
        category_id: 908398,
        date: '2026-05-01',
      }),
    ];

    mockLunchMoneyBudget(41432);

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({path: transactionsListPath})
      .reply(200, createMockTransactionsResponse(mockTransactions))
      .times(1);

    fetchMock
      .get('https://dev.lunchmoney.app')
      .intercept({
        path: '/v1/transactions/2391587215',
        method: 'PUT',
        body: JSON.stringify({
          split: [
            {
              amount: '14.84',
              notes: 'Secret Clinical Strength Deodorant',
              category_id: 908398,
              status: 'uncleared',
            },
            {
              amount: '15.34',
              notes: 'Amazon Basics Toilet Paper',
              category_id: 908398,
              status: 'uncleared',
            },
          ],
        }),
      })
      .reply(200, {success: true});

    await processActions(env);

    expect(telegram.sendVerboseTelegramMessage).toHaveBeenCalledTimes(2);
    expect(telegram.sendVerboseTelegramMessage.mock.calls[0]?.[1]).toContain(
      'Transaction Matched',
    );
    expect(telegram.sendVerboseTelegramMessage.mock.calls[1]?.[1]).toContain(
      'Split details',
    );
    expect(telegram.sendVerboseTelegramMessage.mock.calls[1]?.[1]).toContain(
      'Secret Clinical Strength Deodorant',
    );
    expect(telegram.sendVerboseTelegramMessage.mock.calls[1]?.[1]).toContain(
      'Amazon Basics Toilet Paper',
    );
  });

});
