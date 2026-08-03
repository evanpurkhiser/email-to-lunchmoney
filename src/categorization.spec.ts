import {describe, expect, it} from 'vitest';

import {normalizeLunchMoneyCategories} from './categorization';

describe('normalizeLunchMoneyCategories', () => {
  it('supports object responses with a categories array', () => {
    const normalized = normalizeLunchMoneyCategories({
      categories: [
        {
          id: 10,
          name: 'Health & Fitness',
          is_group: true,
          archived: false,
          children: [
            {
              id: 1,
              name: 'Personal Care',
              group_id: 10,
              is_group: false,
              archived: false,
              is_income: false,
            },
          ],
        },
        {
          id: 2,
          name: 'Groceries',
          is_group: false,
          archived: false,
          is_income: false,
        },
      ],
    });

    expect(normalized).toEqual([
      {id: 1, name: 'Personal Care', groupName: 'Health & Fitness', isIncome: false},
      {id: 2, name: 'Groceries', groupName: null, isIncome: false},
    ]);
  });

  it('drops archived leaves and group rows', () => {
    const normalized = normalizeLunchMoneyCategories({
      categories: [
        {
          id: 10,
          name: 'Archived Group',
          is_group: true,
          archived: false,
          children: [
            {
              id: 1,
              name: 'Archived Child',
              is_group: false,
              archived: true,
              is_income: false,
            },
          ],
        },
        {
          id: 2,
          name: 'Standalone Group',
          is_group: true,
          archived: false,
        },
      ],
    });

    expect(normalized).toEqual([]);
  });

  it('preserves isIncome for matching-direction filtering', () => {
    const normalized = normalizeLunchMoneyCategories({
      categories: [
        {
          id: 1,
          name: 'Income Misc',
          is_group: false,
          archived: false,
          is_income: true,
        },
      ],
    });

    expect(normalized).toEqual([
      {id: 1, name: 'Income Misc', groupName: null, isIncome: true},
    ]);
  });

  it('throws when the response shape is not recognized', () => {
    expect(() => normalizeLunchMoneyCategories({foo: 'bar'})).toThrow(
      'Unexpected Lunch Money categories response shape',
    );
  });
});
