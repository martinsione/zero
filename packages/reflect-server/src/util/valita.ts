import type * as valita from '@badrap/valita';

export function assert<T>(v: unknown, schema: valita.Type<T>): asserts v is T {
  if (typeof MINIFLARE !== 'undefined') {
    // TODO(greg): figure out how to detect when running
    // on `wrangler dev` and assert there as well.
    schema.parse(v);
  }
}

export function assertMapValues<Key, T>(
  map: Map<Key, unknown>,
  schema: valita.Type<T>,
): asserts map is Map<Key, T> {
  for (const [, value] of map) {
    assert(value, schema);
  }
}
