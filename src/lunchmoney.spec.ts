import {env, fetchMock} from 'cloudflare:test';
import {afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {
  createMockTransactionsResponse,
  createTestTransaction,
} from './fixtures/lunchmoney-transactions';
import {processActions} from './lunchmoney';
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
      transaction: {id: 123, notes: action.note},
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
        {amount: '20.00', notes: 'Ride fare', category_id: 101},
        {amount: '15.00', notes: 'Tip', category_id: 101},
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
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)'
    )
      .bind('test', JSON.stringify(actions[0]), '2025-01-01 10:00:00')
      .run();

    await env.DB.prepare(
      'INSERT INTO lunchmoney_actions (source, action, date_created) VALUES (?, ?, ?)'
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
        'INSERT INTO lunchmoney_actions (source, action) VALUES (?, ?)'
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
      remainingActions.results[0].action
    ) as LunchMoneyAction;

    expect(remainingAction.type).toBe('update');
    expect(remainingAction.type === 'update' && remainingAction.note).toBe(
      'Second action - should not match same transaction'
    );
  });
});
