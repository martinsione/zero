import {expect, test} from 'vitest';
import {
  any,
  correlate,
  distinctFrom,
  limit,
  orderBy,
  simple,
  valuePosition,
} from './compiler.ts';
import {formatPg} from './sql.ts';

// Tests the output of basic primitives.
// Top-level things like `SELECT` are tested by actually executing the SQL as inspecting
// the output there is not easy and not as useful when we know each sub-component is generating
// the correct output.

test('limit', () => {
  expect(formatPg(limit(10))).toMatchInlineSnapshot(`
    {
      "text": "LIMIT $1",
      "values": [
        10,
      ],
    }
  `);
  expect(formatPg(limit(undefined))).toMatchInlineSnapshot(`
    {
      "text": "",
      "values": [],
    }
  `);
});

test('orderBy', () => {
  expect(formatPg(orderBy([]))).toMatchInlineSnapshot(`
    {
      "text": "ORDER BY",
      "values": [],
    }
  `);
  expect(
    formatPg(
      orderBy([
        ['name', 'asc'],
        ['age', 'desc'],
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": "ORDER BY "name" ASC, "age" DESC",
      "values": [],
    }
  `);
  expect(
    formatPg(
      orderBy([
        ['name', 'asc'],
        ['age', 'desc'],
        ['id', 'asc'],
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": "ORDER BY "name" ASC, "age" DESC, "id" ASC",
      "values": [],
    }
  `);
  expect(formatPg(orderBy(undefined))).toMatchInlineSnapshot(`
    {
      "text": "",
      "values": [],
    }
  `);
});

test('any', () => {
  expect(
    formatPg(
      any({
        type: 'simple',
        op: 'IN',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: [1, 2, 3]},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" = ANY ($1)",
      "values": [
        [
          1,
          2,
          3,
        ],
      ],
    }
  `);

  expect(
    formatPg(
      any({
        type: 'simple',
        op: 'NOT IN',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: [1, 2, 3]},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" != ANY ($1)",
      "values": [
        [
          1,
          2,
          3,
        ],
      ],
    }
  `);
});

test('valuePosition', () => {
  expect(formatPg(valuePosition({type: 'column', name: 'name'})))
    .toMatchInlineSnapshot(`
    {
      "text": ""name"",
      "values": [],
    }
  `);
  expect(formatPg(valuePosition({type: 'literal', value: 'hello'})))
    .toMatchInlineSnapshot(`
    {
      "text": "$1",
      "values": [
        "hello",
      ],
    }
  `);
  expect(() =>
    formatPg(
      valuePosition({type: 'static', anchor: 'authData', field: 'name'}),
    ),
  ).toThrow(
    'Static parameters must be bound to a value before compiling to SQL',
  );
});

test('distinctFrom', () => {
  expect(
    formatPg(
      distinctFrom({
        type: 'simple',
        op: 'IS',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: null},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" IS NOT DISTINCT FROM $1",
      "values": [
        null,
      ],
    }
  `);

  expect(
    formatPg(
      distinctFrom({
        type: 'simple',
        op: 'IS NOT',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: null},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" IS DISTINCT FROM $1",
      "values": [
        null,
      ],
    }
  `);
});

test('correlate', () => {
  expect(
    formatPg(
      correlate('parent_table', ['id', 'other_id'], 'child_table', [
        'parent_id',
        'parent_other_id',
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""parent_table"."id" = "child_table"."parent_id" AND "parent_table"."other_id" = "child_table"."parent_other_id"",
      "values": [],
    }
  `);

  expect(
    formatPg(correlate('parent_table', ['id'], 'child_table', ['parent_id'])),
  ).toMatchInlineSnapshot(`
    {
      "text": ""parent_table"."id" = "child_table"."parent_id"",
      "values": [],
    }
  `);

  expect(formatPg(correlate('parent_table', [], 'child_table', [])))
    .toMatchInlineSnapshot(`
    {
      "text": "",
      "values": [],
    }
  `);

  expect(() =>
    formatPg(
      correlate('parent_table', ['id', 'other_id'], 'child_table', [
        'parent_id',
      ]),
    ),
  ).toThrow('Assertion failed');
});

test('simple', () => {
  expect(
    formatPg(
      simple({
        type: 'simple',
        op: '=',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: 'test'},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" = $1",
      "values": [
        "test",
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: '!=',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: 'test'},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" != $1",
      "values": [
        "test",
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: '>',
        left: {type: 'column', name: 'age'},
        right: {type: 'literal', value: 21},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""age" > $1",
      "values": [
        21,
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: '>=',
        left: {type: 'column', name: 'age'},
        right: {type: 'literal', value: 21},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""age" >= $1",
      "values": [
        21,
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: '<',
        left: {type: 'column', name: 'age'},
        right: {type: 'literal', value: 21},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""age" < $1",
      "values": [
        21,
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: '<=',
        left: {type: 'column', name: 'age'},
        right: {type: 'literal', value: 21},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""age" <= $1",
      "values": [
        21,
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: 'LIKE',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: '%test%'},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" LIKE $1",
      "values": [
        "%test%",
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: 'NOT LIKE',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: '%test%'},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" NOT LIKE $1",
      "values": [
        "%test%",
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: 'ILIKE',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: '%test%'},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" ILIKE $1",
      "values": [
        "%test%",
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: 'NOT ILIKE',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: '%test%'},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" NOT ILIKE $1",
      "values": [
        "%test%",
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: 'IN',
        left: {type: 'column', name: 'id'},
        right: {type: 'literal', value: [1, 2, 3]},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""id" = ANY ($1)",
      "values": [
        [
          1,
          2,
          3,
        ],
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: 'NOT IN',
        left: {type: 'column', name: 'id'},
        right: {type: 'literal', value: [1, 2, 3]},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""id" != ANY ($1)",
      "values": [
        [
          1,
          2,
          3,
        ],
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: 'IS',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: null},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" IS NOT DISTINCT FROM $1",
      "values": [
        null,
      ],
    }
  `);

  expect(
    formatPg(
      simple({
        type: 'simple',
        op: 'IS NOT',
        left: {type: 'column', name: 'name'},
        right: {type: 'literal', value: null},
      }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "text": ""name" IS DISTINCT FROM $1",
      "values": [
        null,
      ],
    }
  `);
});
