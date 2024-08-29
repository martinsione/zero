/* eslint-disable @typescript-eslint/no-explicit-any */
import {assert} from 'shared/src/asserts.js';
import {resolver} from '@rocicorp/resolver';
import {AST} from '../ast2/ast.js';
import {
  AddSelections,
  AddSubselect,
  Query,
  Operator,
  QueryResultRow,
  Selector,
  DefaultQueryResultRow,
  Smash,
  GetFieldTypeNoNullOrUndefined,
  SchemaToRow,
} from './query.js';
import {
  Schema,
  isFieldRelationship,
  isJunctionRelationship,
  Lazy,
  PullSchemaForRelationship,
} from './schema.js';
import {buildPipeline, Host} from '../builder/builder.js';
import {Ordering} from '../ast2/ast.js';
import {ArrayView} from '../ivm2/array-view.js';
import {TypedView} from './typed-view.js';
import {SubscriptionDelegate} from '../context/context.js';
import {HybridQueryView} from './hybrid-query-view.js';

export function newQuery<
  TSchema extends Schema,
  TReturn extends Array<QueryResultRow> = Array<DefaultQueryResultRow<TSchema>>,
>(host: Host & SubscriptionDelegate, schema: TSchema): Query<TSchema, TReturn> {
  return new QueryImpl(host, schema);
}

class QueryImpl<
  TSchema extends Schema,
  TReturn extends Array<QueryResultRow> = Array<DefaultQueryResultRow<TSchema>>,
  TAs extends string = string,
> implements Query<TSchema, TReturn, TAs>
{
  readonly #ast: AST;
  readonly #host: Host & SubscriptionDelegate;
  readonly #schema: TSchema;

  constructor(
    host: Host & SubscriptionDelegate,
    schema: TSchema,
    ast?: AST | undefined,
  ) {
    this.#ast = ast ?? {
      table: schema.table,
    };
    this.#host = host;
    this.#schema = schema;
  }

  #create<
    TSchema extends Schema,
    TReturn extends Array<QueryResultRow>,
    TAs extends string,
  >(
    host: Host & SubscriptionDelegate,
    schema: TSchema,
    ast: AST,
  ): Query<TSchema, TReturn, TAs> {
    return new QueryImpl(host, schema, ast);
  }

  get ast() {
    return this.#ast;
  }

  select<TFields extends Selector<TSchema>[]>(
    ..._fields: TFields
  ): Query<TSchema, AddSelections<TSchema, TFields, TReturn>[], TAs> {
    // we return all columns for now so we ignore the selection set and only use it for type inference
    return this.#create(this.#host, this.#schema, this.#ast);
  }

  materialize(): TypedView<Smash<TReturn>> {
    const ast = this.#completeAst();
    const view = new HybridQueryView(
      this.#host,
      ast,
      new ArrayView(buildPipeline(ast, this.#host)),
    );
    return view as unknown as TypedView<Smash<TReturn>>;
  }

  preload(): {
    cleanup: () => void;
    preloaded: Promise<boolean>;
  } {
    const {resolve, promise: preloaded} = resolver<boolean>();
    const subscriptionRemoved = this.#host.subscriptionAdded(
      this.#completeAst(),
      got => {
        if (got) {
          resolve(true);
        }
      },
    );
    const cleanup = () => {
      subscriptionRemoved();
      resolve(false);
    };
    return {
      cleanup,
      preloaded,
    };
  }

  #completeAst(): AST {
    return {
      ...this.#ast,
      orderBy: addPrimaryKeys(this.#schema, this.#ast.orderBy),
    };
  }

  related<TRelationship extends keyof TSchema['relationships']>(
    relationship: TRelationship,
  ): Query<
    TSchema,
    Array<
      AddSubselect<
        Query<
          PullSchemaForRelationship<TSchema, TRelationship>,
          Array<
            DefaultQueryResultRow<
              PullSchemaForRelationship<TSchema, TRelationship>
            >
          >,
          TRelationship & string
        >,
        TReturn
      >
    >,
    TAs
  >;
  related<
    TRelationship extends keyof TSchema['relationships'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TSub extends Query<any, any, any>,
  >(
    relationship: TRelationship,
    cb: (
      query: Query<
        PullSchemaForRelationship<TSchema, TRelationship>,
        Array<
          DefaultQueryResultRow<
            PullSchemaForRelationship<TSchema, TRelationship>
          >
        >,
        TRelationship & string
      >,
    ) => TSub = q => q as any,
  ): Query<TSchema, Array<AddSubselect<TSub, TReturn>>, TAs> {
    const related = this.#schema.relationships?.[relationship as string];
    assert(related, 'Invalid relationship');
    const related1 = related;
    const related2 = related;
    if (isFieldRelationship(related1)) {
      const destSchema = resolveSchema(related1.dest.schema);
      return this.#create(this.#host, this.#schema, {
        ...this.#ast,
        related: [
          ...(this.#ast.related ?? []),
          {
            correlation: {
              parentField: related1.source,
              childField: related1.dest.field,
              op: '=',
            },
            subquery: addPrimaryKeysToAst(
              destSchema,
              cb(
                this.#create(this.#host, destSchema, {
                  table: destSchema.table,
                  alias: relationship as string,
                }),
              ).ast,
            ),
          },
        ],
      });
    }

    if (isJunctionRelationship(related2)) {
      const destSchema = resolveSchema(related2.dest.schema);
      const junctionSchema = resolveSchema(related2.junction.schema);
      return this.#create(this.#host, this.#schema, {
        ...this.#ast,
        related: [
          ...(this.#ast.related ?? []),
          {
            correlation: {
              parentField: related2.source,
              childField: related2.junction.sourceField,
              op: '=',
            },
            subquery: {
              table: junctionSchema.table,
              alias: relationship as string,
              orderBy: addPrimaryKeys(junctionSchema, undefined),
              related: [
                {
                  correlation: {
                    parentField: related2.junction.destField,
                    childField: related2.dest.field,
                    op: '=',
                  },
                  subquery: addPrimaryKeysToAst(
                    destSchema,
                    cb(
                      this.#create(this.#host, destSchema, {
                        table: destSchema.table,
                        alias: relationship as string,
                      }),
                    ).ast,
                  ),
                },
              ],
            },
          },
        ],
      });
    }
    throw new Error(`Invalid relationship ${relationship as string}`);
  }

  where<TSelector extends Selector<TSchema>>(
    field: TSelector,
    op: Operator,
    value: GetFieldTypeNoNullOrUndefined<TSchema, TSelector, Operator>,
  ): Query<TSchema, TReturn, TAs> {
    return this.#create(this.#host, this.#schema, {
      ...this.#ast,
      where: [
        ...(this.#ast.where ?? []),
        {
          type: 'simple',
          op,
          field: field as string,
          value,
        },
      ],
    });
  }

  as<TAs2 extends string>(alias: TAs2): Query<TSchema, TReturn, TAs2> {
    return this.#create(this.#host, this.#schema, {
      ...this.#ast,
      alias,
    });
  }

  start(
    row: Partial<SchemaToRow<TSchema>>,
    opts?: {inclusive: boolean} | undefined,
  ): Query<TSchema, TReturn, TAs> {
    return this.#create(this.#host, this.#schema, {
      ...this.#ast,
      start: {
        row,
        exclusive: !opts?.inclusive,
      },
    });
  }

  limit(limit: number): Query<TSchema, TReturn, TAs> {
    return this.#create(this.#host, this.#schema, {
      ...this.#ast,
      limit,
    });
  }

  orderBy<TSelector extends keyof TSchema['fields']>(
    field: TSelector,
    direction: 'asc' | 'desc',
  ): Query<TSchema, TReturn, TAs> {
    return this.#create(this.#host, this.#schema, {
      ...this.#ast,
      orderBy: [...(this.#ast.orderBy ?? []), [field as string, direction]],
    });
  }
}

function resolveSchema(maybeSchema: Schema | Lazy<Schema>): Schema {
  if (typeof maybeSchema === 'function') {
    return maybeSchema();
  }

  return maybeSchema;
}

function addPrimaryKeys(
  schema: Schema,
  orderBy: Ordering | undefined,
): Ordering {
  orderBy = orderBy ?? [];
  const primaryKeys = schema.primaryKey;
  const primaryKeysToAdd = new Set(primaryKeys);

  for (const [field] of orderBy) {
    primaryKeysToAdd.delete(field);
  }

  if (primaryKeysToAdd.size === 0) {
    return orderBy;
  }

  return [
    ...orderBy,
    ...[...primaryKeysToAdd].map(key => [key, 'asc'] as [string, 'asc']),
  ];
}

function addPrimaryKeysToAst(schema: Schema, ast: AST): AST {
  return {
    ...ast,
    orderBy: addPrimaryKeys(schema, ast.orderBy),
  };
}
