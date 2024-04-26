import type {LogContext} from '@rocicorp/logger';
import type {AST} from '@rocicorp/zql/src/zql/ast/ast.js';
import {assert} from 'shared/src/asserts.js';
import type {
  JSONObject,
  JSONValue,
  ReadonlyJSONValue,
} from 'shared/src/json.js';
import {rowKeyHash} from '../../types/row-key.js';
import {
  ALIAS_COMPONENT_SEPARATOR,
  expandSelection,
} from '../../zql/expansion.js';
import {
  computeInvalidationInfo,
  type InvalidationInfo,
} from '../../zql/invalidation.js';
import {Normalized} from '../../zql/normalize.js';
import {ZERO_VERSION_COLUMN_NAME} from '../replicator/tables/replication.js';
import type {TableSpec} from '../replicator/tables/specs.js';
import type {QueryRecord, RowID, RowRecord} from './schema/types.js';

export class InvalidQueryError extends Error {}

export type TransformedQuery = {
  readonly queryID: string;
  readonly transformedAST: Normalized;
  readonly transformationHash: string;
  readonly invalidationInfo: InvalidationInfo;
};

export class QueryHandler {
  readonly #tables: TableSchemas;

  constructor(tables: readonly TableSpec[]) {
    this.#tables = new TableSchemas(tables);
  }

  /**
   * Transforms the client-desired queries into normalized, expanded versions that
   * includes primary key columns, the row version column, and all columns required
   * to compute the query.
   */
  transform(
    queries: (QueryRecord | {id: string; ast: AST})[],
  ): Record<string, TransformedQuery> {
    return Object.fromEntries(
      queries.map(q => {
        const requiredColumns = (tableRef: string) => {
          const table = this.#tables.spec(tableRef);
          if (!table) {
            throw new InvalidQueryError(
              `Unknown table "${tableRef}" in ${JSON.stringify(q.ast)}`,
            );
          }
          return [...table.primaryKey, ZERO_VERSION_COLUMN_NAME];
        };

        const expanded = expandSelection(q.ast, requiredColumns);
        const transformedAST = new Normalized(expanded);
        const transformationHash = transformedAST.hash();
        const invalidationInfo = computeInvalidationInfo(transformedAST);
        return [
          q.id,
          {
            queryID: q.id,
            transformedAST,
            transformationHash,
            invalidationInfo,
          },
        ];
      }),
    );
  }

  /**
   * Returns an object for deconstructing each result from executed queries
   * into its constituent tables and rows.
   */
  resultProcessor(lc: LogContext) {
    return new ResultProcessor(lc, this.#tables);
  }
}

export type RowResult = {
  record: Omit<RowRecord, 'putPatch'>;
  contents: Record<string, ReadonlyJSONValue>;
};

class ResultProcessor {
  readonly #lc: LogContext;
  readonly #tables: TableSchemas;
  readonly #results = new Map<string, RowResult>();

  constructor(lc: LogContext, tables: TableSchemas) {
    this.#lc = lc;
    this.#tables = tables;
  }

  /**
   * Processes the query results by decomposing each result into its constituent
   * rows, according to the column naming schema defined by {@link expandSelection}.
   * Multiple views of rows from different queries are merged, with the query to column
   * mapping tracked in the `record` field of the returned {@link RowResult}.
   */
  // eslint-disable-next-line require-await
  async processResults(
    queryID: string,
    results: Record<string, JSONValue>[],
  ): Promise<void> {
    for (const result of results) {
      // Partitions the values of the full result into individual "subquery/table" keys.
      // For example, a result:
      // ```
      // {
      //   "issues/id": 1,
      //   "issues/name": "foo",
      //   "owner/users/id": 3,
      //   "owner/users/name: "moar",
      //   "parent/issues/id": 5,
      //   "parent/issues/name" "trix",
      // }
      // ```
      //
      // is partitioned into:
      //
      // ```
      // "issues": {id: 1, name: "foo"}
      // "owners/users": {id: 3, name: "moar"}
      // "parent/issues": {id: 5, name: "trix"}
      //```
      const rows = new Map<string, JSONObject>();

      for (const [alias, value] of Object.entries(result)) {
        const [rowAlias, columnName] = splitLastComponent(alias);
        const row = rows.get(rowAlias);
        row
          ? (row[columnName] = value)
          : rows.set(rowAlias, {[columnName]: value});
      }

      // Now, merge each row into its corresponding RowResult by row key.
      for (const [rowAlias, row] of rows.entries()) {
        const [_, table] = splitLastComponent(rowAlias);
        const id = this.#tables.rowID(table, row);
        const key = makeKey(id);
        const rowVersion = row[ZERO_VERSION_COLUMN_NAME];
        assert(
          typeof rowVersion === 'string',
          `Invalid _0_version in ${JSON.stringify(row)}`,
        );
        // Exclude the _0_version column from what is sent to the client.
        delete row['_0_version'];

        let rowResult = this.#results.get(key);
        if (!rowResult) {
          rowResult = {
            record: {id, rowVersion, queriedColumns: {}},
            contents: {},
          };
          this.#results.set(key, rowResult);
        }
        for (const col of Object.keys(row)) {
          (rowResult.record.queriedColumns[col] ??= []).push(queryID);
        }
        rowResult.contents = {
          ...rowResult.contents,
          ...(row as Record<string, Exclude<ReadonlyJSONValue, undefined>>), // TODO: Switch to a JSONObject definition that doesn't include undefined.
        };
      }
    }
    this.#lc
      .withContext('queryID', queryID)
      .debug?.(`processed ${results.length} results`);
  }

  getResults(): IterableIterator<RowResult> {
    this.#lc.info?.(`deconstructed results into ${this.#results.size} rows`);
    return this.#results.values();
  }
}

class TableSchemas {
  readonly #tables: Map<string, TableSpec>;

  constructor(tables: readonly TableSpec[]) {
    this.#tables = new Map(tables.map(t => [`${t.schema}.${t.name}`, t]));
  }

  spec(tableRef: string): TableSpec | undefined {
    return this.#tables.get(
      tableRef.includes('.') ? tableRef : `public.${tableRef}`,
    );
  }

  rowID(tableRef: string, row: JSONObject): RowID {
    const table = this.spec(tableRef);
    assert(table, `No TableSpec for "${tableRef}"`);

    const rowKey = Object.fromEntries(
      table.primaryKey.map(col => {
        const val = row[col];
        assert(val, `Primary key "${col}" missing from row in ${tableRef}`);
        return [col, val];
      }),
    );
    return {schema: table.schema, table: table.name, rowKey};
  }
}

function makeKey(row: RowID) {
  const {schema, table, rowKey} = row;
  const hash = rowKeyHash(rowKey);
  return `${schema}/${table}/${hash}`;
}

function splitLastComponent(str: string): [prefix: string, suffix: string] {
  const lastSlash = str.lastIndexOf(ALIAS_COMPONENT_SEPARATOR);
  return lastSlash < 0
    ? ['', str]
    : [str.substring(0, lastSlash), str.substring(lastSlash + 1)];
}
