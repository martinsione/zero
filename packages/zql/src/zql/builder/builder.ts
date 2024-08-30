import {assert} from 'shared/src/asserts.js';
import {AST} from '../ast2/ast.js';
import {Filter} from '../ivm/filter.js';
import {Join} from '../ivm/join.js';
import {Input, Storage} from '../ivm/operator.js';
import {Source} from '../ivm/source.js';
import {createPredicate} from './filter.js';
import {must} from 'shared/src/must.js';
import {Take} from '../ivm/take.js';
import {Skip} from '../ivm/skip.js';

/**
 * Interface required of caller to buildPipeline. Connects to constructed
 * pipeline to host environment to provide sources and storage.
 */
export interface Host {
  /**
   * Called once for each source needed by the AST.
   * Might be called multiple times with same tableName. It is OK to return
   * same storage instance in that case.
   */
  getSource(tableName: string): Source;

  /**
   * Called once for each operator that requires storage. Should return a new
   * unique storage object for each call.
   */
  createStorage(): Storage;
}

/**
 * Builds a pipeline from an AST. Caller must provide a Host to create source
 * and storage interfaces as necessary.
 *
 * Usage:
 *
 * ```ts
 * class MySink implements Output {
 *   readonly #input: Input;
 *
 *   constructor(input: Input) {
 *     this.#input = input;
 *     this.#input.setOutput(this);
 *     console.log([...this.#input.hydrate()]);
 *   }
 *
 *   push(change: Change, _: Operator) {
 *     console.log(change);
 *   }
 * }
 *
 * const input = buildPipeline(ast, myHost);
 * const sink = new MySink(input);
 * ```
 */
export function buildPipeline(ast: AST, host: Host): Input {
  return buildPipelineInternal(ast, host);
}

function buildPipelineInternal(
  ast: AST,
  host: Host,
  partitionKey?: string | undefined,
): Input {
  const source = host.getSource(ast.table);
  const conn = source.connect(must(ast.orderBy), ast.where ?? []);
  let end: Input = conn;
  const {appliedFilters} = conn;

  if (ast.start) {
    end = new Skip(end, ast.start);
  }

  if (ast.where) {
    for (const condition of ast.where) {
      end = new Filter(
        end,
        appliedFilters ? 'push-only' : 'all',
        createPredicate(condition),
      );
    }
  }

  if (ast.limit) {
    end = new Take(end, host.createStorage(), ast.limit, partitionKey);
  }

  if (ast.related) {
    for (const sq of ast.related) {
      assert(sq.subquery.alias, 'Subquery must have an alias');
      const child = buildPipelineInternal(
        sq.subquery,
        host,
        sq.correlation.childField,
      );
      end = new Join({
        parent: end,
        child,
        storage: host.createStorage(),
        parentKey: sq.correlation.parentField,
        childKey: sq.correlation.childField,
        relationshipName: sq.subquery.alias,
        hidden: sq.hidden ?? false,
      });
    }
  }

  return end;
}
