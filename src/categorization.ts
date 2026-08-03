import OpenAI from 'openai';

import type {LunchMoneyAction} from './types';

export interface LunchMoneyCategory {
  id: number;
  name: string;
  groupName: string | null;
  isIncome: boolean;
}

interface LunchMoneyCategoryResponse {
  categories?: unknown;
}

interface RawLunchMoneyCategory {
  id: unknown;
  name: unknown;
  group_id?: unknown;
  group_name?: unknown;
  is_income?: unknown;
  is_group?: unknown;
  archived?: unknown;
  children?: unknown;
}

interface UpdateCategorization {
  kind: 'update';
  categoryId: number | null;
}

interface SplitCategorization {
  kind: 'split';
  categoryIds: Array<number | null>;
}

export type CategorizationResult = UpdateCategorization | SplitCategorization;

const NULLABLE_INTEGER_SCHEMA = {
  anyOf: [{type: 'integer'}, {type: 'null'}],
} as const;

const UPDATE_SCHEMA = {
  type: 'json_schema',
  name: 'category_selection',
  schema: {
    type: 'object',
    properties: {
      categoryId: NULLABLE_INTEGER_SCHEMA,
    },
    required: ['categoryId'],
    additionalProperties: false,
  },
} as const;

const SPLIT_SCHEMA = {
  type: 'json_schema',
  name: 'split_category_selection',
  schema: {
    type: 'object',
    properties: {
      categoryIds: {
        type: 'array',
        items: NULLABLE_INTEGER_SCHEMA,
      },
    },
    required: ['categoryIds'],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT = `You categorize transactions into existing Lunch Money categories.

Rules:
- You must only choose category IDs from the provided category list.
- Prefer the meaning of the note text over the payee name when they differ.
- Return null instead of guessing when the best category is unclear.
- Do not invent categories or IDs.
- For split transactions, return exactly one category ID (or null) per split item, in the same order.`;

function getCategoryLabel(category: LunchMoneyCategory) {
  return category.groupName === null ? category.name : `${category.groupName} > ${category.name}`;
}

function getAllowedCategoryIds(categories: LunchMoneyCategory[]) {
  return new Set(categories.map(category => category.id));
}

function parseNullableCategoryId(value: unknown, allowedIds: Set<number>) {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }

  return allowedIds.has(value) ? value : null;
}

export function normalizeAssignableCategories(response: unknown): LunchMoneyCategory[] {
  const rawCategories = Array.isArray(response)
    ? response
    : (response as LunchMoneyCategoryResponse).categories;

  if (!Array.isArray(rawCategories)) {
    throw new Error('Unexpected Lunch Money categories response shape');
  }

  return rawCategories
    .map(category => {
      if (
        category === null ||
        typeof category !== 'object' ||
        !('id' in category) ||
        !('name' in category)
      ) {
        return null;
      }

      const id = category.id;
      const name = category.name;
      const groupName = 'group_name' in category ? category.group_name : null;

      if (typeof id !== 'number' || !Number.isInteger(id) || typeof name !== 'string') {
        return null;
      }

      return {
        id,
        name,
        groupName: typeof groupName === 'string' ? groupName : null,
        isIncome: false,
      };
    })
    .filter((category): category is LunchMoneyCategory => category !== null);
}

export async function fetchAssignableCategories(token: string) {
  const response = await fetch('https://api.lunchmoney.dev/v2/categories', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`LunchMoney categories API error: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as unknown;
  return normalizeLunchMoneyCategories(body);
}

function toLeafCategory(
  category: RawLunchMoneyCategory,
  fallbackGroupName: string | null,
): LunchMoneyCategory | null {
  if (
    typeof category.id !== 'number' ||
    !Number.isInteger(category.id) ||
    typeof category.name !== 'string'
  ) {
    return null;
  }

  if (category.archived === true || category.is_group === true) {
    return null;
  }

  return {
    id: category.id,
    name: category.name,
    groupName:
      typeof category.group_name === 'string'
        ? category.group_name
        : fallbackGroupName,
    isIncome: category.is_income === true,
  };
}

export function normalizeLunchMoneyCategories(response: unknown): LunchMoneyCategory[] {
  const rawCategories = Array.isArray(response)
    ? response
    : (response as LunchMoneyCategoryResponse).categories;

  if (!Array.isArray(rawCategories)) {
    throw new Error('Unexpected Lunch Money categories response shape');
  }

  return rawCategories.flatMap(rawCategory => {
    if (rawCategory === null || typeof rawCategory !== 'object') {
      return [];
    }

    const category = rawCategory as RawLunchMoneyCategory;
    const groupName =
      category.is_group === true && typeof category.name === 'string'
        ? category.name
        : null;

    if (Array.isArray(category.children)) {
      return category.children
        .map(child =>
          child !== null && typeof child === 'object'
            ? toLeafCategory(child as RawLunchMoneyCategory, groupName)
            : null,
        )
        .filter((child): child is LunchMoneyCategory => child !== null);
    }

    const leaf = toLeafCategory(category, null);
    return leaf === null ? [] : [leaf];
  });
}

async function requestCategorization(
  env: Env,
  schema: typeof UPDATE_SCHEMA | typeof SPLIT_SCHEMA,
  input: string,
) {
  const client = new OpenAI({apiKey: env.OPENAI_API_KEY});

  const response = await client.responses.create({
    model: 'o4-mini',
    text: {format: schema},
    input: [
      {
        role: 'system',
        content: [{type: 'input_text', text: SYSTEM_PROMPT}],
      },
      {
        role: 'user',
        content: [{type: 'input_text', text: input}],
      },
    ],
  });

  return JSON.parse(response.output_text) as Record<string, unknown>;
}

export async function categorizeAction(
  env: Env,
  action: LunchMoneyAction,
  source: string,
  payee: string,
  categories: LunchMoneyCategory[],
) {
  if (categories.length === 0) {
    return action.type === 'update'
      ? ({kind: 'update', categoryId: null} satisfies UpdateCategorization)
      : ({
          kind: 'split',
          categoryIds: action.split.map(() => null),
        } satisfies SplitCategorization);
  }

  const allowedIds = getAllowedCategoryIds(categories);
  const categoryList = categories
    .map(category => `${category.id}: ${getCategoryLabel(category)}`)
    .join('\n');

  if (action.type === 'update') {
    const input = [
      `Source: ${source}`,
      `Payee: ${payee}`,
      `Transaction note: ${action.note}`,
      '',
      'Available categories:',
      categoryList,
    ].join('\n');

    const response = await requestCategorization(env, UPDATE_SCHEMA, input);

    return {
      kind: 'update',
      categoryId: parseNullableCategoryId(response.categoryId, allowedIds),
    } satisfies UpdateCategorization;
  }

  const splitLines = action.split
    .map((item, index) => `${index + 1}. ${item.note}`)
    .join('\n');

  const input = [
    `Source: ${source}`,
    `Payee: ${payee}`,
    'Split items:',
    splitLines,
    '',
    'Available categories:',
    categoryList,
  ].join('\n');

  const response = await requestCategorization(env, SPLIT_SCHEMA, input);
  const rawCategoryIds = Array.isArray(response.categoryIds) ? response.categoryIds : [];

  const categoryIds = action.split.map((_, index) =>
    parseNullableCategoryId(rawCategoryIds[index] ?? null, allowedIds),
  );

  return {
    kind: 'split',
    categoryIds,
  } satisfies SplitCategorization;
}
