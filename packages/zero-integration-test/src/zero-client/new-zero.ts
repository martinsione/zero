import {LogContext} from '@rocicorp/logger';
import {Zero, type Schema} from '../../../zero-client/src/mod.js';
import {nanoid} from '../../../zero-client/src/util/nanoid.js';

export function newZero<S extends Schema>(_lc: LogContext, schema: S): Zero<S> {
  const z = new Zero({
    userID: 'user-' + nanoid(),
    schema,
  });
  return z;
}

export type Z = ReturnType<typeof newZero>;
