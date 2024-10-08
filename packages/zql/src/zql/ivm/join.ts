import {assert, unreachable} from '../../../../shared/src/asserts.js';
import {must} from '../../../../shared/src/must.js';
import type {Change, ChildChange} from './change.js';
import {
  normalizeUndefined,
  type Node,
  type NormalizedValue,
  type Row,
} from './data.js';
import type {FetchRequest, Input, Output, Storage} from './operator.js';
import type {TableSchema} from './schema.js';
import {first, take, type Stream} from './stream.js';

type Args = {
  parent: Input;
  child: Input;
  storage: Storage;
  parentKey: string;
  childKey: string;
  relationshipName: string;
  hidden: boolean;
};
/**
 * The Join operator joins the output from two upstream inputs. Zero's join
 * is a little different from SQL's join in that we output hierarchical data,
 * not a flat table. This makes it a lot more useful for UI programming and
 * avoids duplicating tons of data like left join would.
 *
 * The Nodes output from Join have a new relationship added to them, which has
 * the name #relationshipName. The value of the relationship is a stream of
 * child nodes which are the corresponding values from the child source.
 */
export class Join implements Input {
  readonly #parent: Input;
  readonly #child: Input;
  readonly #storage: Storage;
  readonly #parentKey: string;
  readonly #childKey: string;
  readonly #relationshipName: string;
  readonly #schema: TableSchema;

  #output: Output | null = null;

  constructor({
    parent,
    child,
    storage,
    parentKey,
    childKey,
    relationshipName,
    hidden,
  }: Args) {
    assert(parent !== child, 'Parent and child must be different operators');

    this.#parent = parent;
    this.#child = child;
    this.#storage = storage;
    this.#parentKey = parentKey;
    this.#childKey = childKey;
    this.#relationshipName = relationshipName;

    const parentSchema = parent.getSchema();
    const childSchema = child.getSchema();
    this.#schema = {
      ...parentSchema,
      isHidden: hidden,
      relationships: {
        ...parentSchema.relationships,
        [relationshipName]: childSchema,
      },
    };

    parent.setOutput({
      push: (change: Change) => this.#pushParent(change),
    });
    child.setOutput({
      push: (change: Change) => this.#pushChild(change),
    });
  }

  destroy(): void {
    this.#parent.destroy();
    this.#child.destroy();
  }

  setOutput(output: Output): void {
    this.#output = output;
  }

  getSchema(): TableSchema {
    return this.#schema;
  }

  *fetch(req: FetchRequest): Stream<Node> {
    for (const parentNode of this.#parent.fetch(req)) {
      yield this.#processParentNode(
        parentNode.row,
        parentNode.relationships,
        'fetch',
      );
    }
  }

  *cleanup(req: FetchRequest): Stream<Node> {
    for (const parentNode of this.#parent.cleanup(req)) {
      yield this.#processParentNode(
        parentNode.row,
        parentNode.relationships,
        'cleanup',
      );
    }
  }

  #pushParent(change: Change): void {
    assert(this.#output, 'Output not set');

    switch (change.type) {
      case 'add':
        this.#output.push({
          type: 'add',
          node: this.#processParentNode(
            change.node.row,
            change.node.relationships,
            'fetch',
          ),
        });
        break;
      case 'remove':
        this.#output.push({
          type: 'remove',
          node: this.#processParentNode(
            change.node.row,
            change.node.relationships,
            'cleanup',
          ),
        });
        break;
      case 'child':
        this.#output.push(change);
        break;
      case 'edit':
        // If the join key value didn't change we push the change down
        if (
          normalizeUndefined(change.row[this.#parentKey]) ===
          normalizeUndefined(change.oldRow[this.#parentKey])
        ) {
          this.#output.push(change);
        } else {
          // The join key value changed so we treat this as a remove followed by
          // an add.
          this.#output.push({
            type: 'remove',
            node: this.#processParentNode(change.oldRow, {}, 'cleanup'),
          });
          this.#output.push({
            type: 'add',
            node: this.#processParentNode(change.row, {}, 'fetch'),
          });
        }
        break;
      default:
        unreachable(change);
    }
  }

  #pushChild(change: Change): void {
    const pushChildChange = (childRow: Row, change: Change) => {
      assert(this.#output, 'Output not set');

      const parentNodes = this.#parent.fetch({
        constraint: {
          key: this.#parentKey,
          value: childRow[this.#childKey],
        },
      });

      for (const parentNode of parentNodes) {
        const childChange: ChildChange = {
          type: 'child',
          row: parentNode.row,
          child: {
            relationshipName: this.#relationshipName,
            change,
          },
        };
        this.#output.push(childChange);
      }
    };

    switch (change.type) {
      case 'add':
      case 'remove':
        pushChildChange(change.node.row, change);
        break;
      case 'child':
        pushChildChange(change.row, change);
        break;
      case 'edit': {
        const childRow = change.row;
        const oldChildRow = change.oldRow;
        if (
          normalizeUndefined(oldChildRow[this.#childKey]) ===
          normalizeUndefined(childRow[this.#childKey])
        ) {
          // The child row was edited in a way that does not change the relationship.
          // We can therefore just push the change down (wrapped in a child change).
          pushChildChange(childRow, change);
        } else {
          // The child row was edited in a way that changes the relationship. We
          // therefore treat this as a remove from the old row followed by an
          // add to the new row.

          const {relationships} = must(
            first(
              this.#child.fetch({
                constraint: {
                  key: this.#childKey,
                  value: oldChildRow[this.#childKey],
                },
              }),
            ),
          );

          pushChildChange(oldChildRow, {
            type: 'remove',
            node: {
              row: oldChildRow,
              relationships,
            },
          });
          pushChildChange(childRow, {
            type: 'add',
            node: {
              row: childRow,
              relationships,
            },
          });
        }
        break;
      }

      default:
        unreachable(change);
    }
  }

  #processParentNode(
    parentNodeRow: Row,
    parentNodeRelations: Record<string, Stream<Node>>,
    mode: ProcessParentMode,
  ): Node {
    const parentKeyValue = normalizeUndefined(parentNodeRow[this.#parentKey]);
    const parentPrimaryKey: NormalizedValue[] = [];
    for (const key of this.#parent.getSchema().primaryKey) {
      parentPrimaryKey.push(normalizeUndefined(parentNodeRow[key]));
    }

    // This storage key tracks the primary keys seen for each unique
    // value joined on. This is used to know when to cleanup a child's state.
    const storageKey: string = createPrimaryKeySetStorageKey([
      parentKeyValue,
      ...parentPrimaryKey,
    ]);

    let method: ProcessParentMode = mode;
    if (mode === 'cleanup') {
      const [, second] = take(
        this.#storage.scan({
          prefix: createPrimaryKeySetStorageKeyPrefix(parentKeyValue),
        }),
        2,
      );
      method = second ? 'fetch' : 'cleanup';
    }

    const childStream = this.#child[method]({
      constraint: {
        key: this.#childKey,
        value: parentKeyValue,
      },
    });

    if (mode === 'fetch') {
      this.#storage.set(storageKey, true);
    } else {
      mode satisfies 'cleanup';
      this.#storage.del(storageKey);
    }

    return {
      row: parentNodeRow,
      relationships: {
        ...parentNodeRelations,
        [this.#relationshipName]: childStream,
      },
    };
  }
}

type ProcessParentMode = 'fetch' | 'cleanup';

/** Exported for testing. */
export function createPrimaryKeySetStorageKey(
  values: NormalizedValue[],
): string {
  const json = JSON.stringify(['pKeySet', ...values]);
  return json.substring(1, json.length - 1) + ',';
}

export function createPrimaryKeySetStorageKeyPrefix(
  value: NormalizedValue,
): string {
  return createPrimaryKeySetStorageKey([value]);
}
