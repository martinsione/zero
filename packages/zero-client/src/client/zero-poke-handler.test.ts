import {LogContext} from '@rocicorp/logger';
import {
  afterEach,
  beforeEach,
  expect,
  test,
  suite,
  vi,
  MockInstance,
} from 'vitest';
import {PokeHandler, mergePokes} from './zero-poke-handler.js';
import {resolver} from '@rocicorp/resolver';

let rafStub: MockInstance<[FrameRequestCallback], number>;
// The FrameRequestCallback in PokeHandler does not use
// its time argument, so use an arbitrary constant for it in tests.
const UNUSED_RAF_ARG = 10;

beforeEach(() => {
  rafStub = vi
    .spyOn(globalThis, 'requestAnimationFrame')
    .mockImplementation(() => 0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('completed poke plays on first raf', async () => {
  const onPokeErrorStub = vi.fn();
  const replicachePokeStub = vi.fn();
  const clientID = 'c1';
  const logContext = new LogContext('error');
  const pokeHandler = new PokeHandler(
    replicachePokeStub,
    onPokeErrorStub,
    clientID,
    logContext,
  );
  expect(rafStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke1',
    baseCookie: 1,
    cookie: 2,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 1,
      c2: 2,
    },
    entitiesPatch: [{op: 'put', key: 'foo', value: 'foo1'}],
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 2,
    },
    entitiesPatch: [
      {op: 'put', key: 'foo', value: 'foo2'},
      {op: 'put', key: 'bar', value: 'bar1'},
    ],
  });

  expect(rafStub).toHaveBeenCalledTimes(0);

  pokeHandler.handlePokeEnd({pokeID: 'poke1'});

  expect(rafStub).toHaveBeenCalledTimes(1);
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);

  const rafCallback0 = rafStub.mock.calls[0][0];
  await rafCallback0(UNUSED_RAF_ARG);

  expect(replicachePokeStub).toHaveBeenCalledTimes(1);
  const replicachePoke0 = replicachePokeStub.mock.calls[0][0];
  expect(replicachePoke0).to.deep.equal({
    baseCookie: 1,
    pullResponse: {
      cookie: 2,
      lastMutationIDChanges: {
        c1: 2,
        c2: 2,
      },
      patch: [
        {op: 'put', key: 'e/foo', value: 'foo1'},
        {op: 'put', key: 'e/foo', value: 'foo2'},
        {op: 'put', key: 'e/bar', value: 'bar1'},
      ],
    },
  });

  expect(rafStub).toHaveBeenCalledTimes(2);

  const rafCallback1 = rafStub.mock.calls[1][0];
  await rafCallback1(UNUSED_RAF_ARG);
  expect(replicachePokeStub).toHaveBeenCalledTimes(1);
  expect(rafStub).toHaveBeenCalledTimes(2);
});

test('multiple pokes received before raf callback are merged', async () => {
  const onPokeErrorStub = vi.fn();
  const replicachePokeStub = vi.fn();
  const clientID = 'c1';
  const logContext = new LogContext('error');
  const pokeHandler = new PokeHandler(
    replicachePokeStub,
    onPokeErrorStub,
    clientID,
    logContext,
  );

  expect(rafStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke1',
    baseCookie: 1,
    cookie: 2,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 1,
      c2: 2,
    },
    entitiesPatch: [{op: 'put', key: 'foo', value: 'foo1'}],
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 2,
    },
    entitiesPatch: [
      {op: 'put', key: 'foo', value: 'foo2'},
      {op: 'put', key: 'bar', value: 'bar1'},
    ],
  });

  expect(rafStub).toHaveBeenCalledTimes(0);
  pokeHandler.handlePokeEnd({pokeID: 'poke1'});

  expect(rafStub).toHaveBeenCalledTimes(1);
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke2',
    baseCookie: 2,
    cookie: 3,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke2',
    lastMutationIDChanges: {
      c1: 3,
    },
    entitiesPatch: [{op: 'put', key: 'baz', value: 'baz1'}],
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke2',
    lastMutationIDChanges: {
      c3: 1,
    },
    entitiesPatch: [{op: 'put', key: 'bar', value: 'bar2'}],
  });

  expect(rafStub).toHaveBeenCalledTimes(1);

  pokeHandler.handlePokeEnd({pokeID: 'poke2'});

  expect(rafStub).toHaveBeenCalledTimes(1);
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);

  const rafCallback0 = rafStub.mock.calls[0][0];
  await rafCallback0(UNUSED_RAF_ARG);

  expect(replicachePokeStub).toHaveBeenCalledTimes(1);
  const replicachePoke0 = replicachePokeStub.mock.calls[0][0];
  expect(replicachePoke0).to.deep.equal({
    baseCookie: 1,
    pullResponse: {
      cookie: 3,
      lastMutationIDChanges: {
        c1: 3,
        c2: 2,
        c3: 1,
      },
      patch: [
        {op: 'put', key: 'e/foo', value: 'foo1'},
        {op: 'put', key: 'e/foo', value: 'foo2'},
        {op: 'put', key: 'e/bar', value: 'bar1'},
        {op: 'put', key: 'e/baz', value: 'baz1'},
        {op: 'put', key: 'e/bar', value: 'bar2'},
      ],
    },
  });

  expect(rafStub).toHaveBeenCalledTimes(2);

  const rafCallback1 = rafStub.mock.calls[1][0];
  await rafCallback1(UNUSED_RAF_ARG);
  expect(replicachePokeStub).toHaveBeenCalledTimes(1);
  expect(rafStub).toHaveBeenCalledTimes(2);
});

test('playback over series of rafs', async () => {
  const onPokeErrorStub = vi.fn();
  const replicachePokeStub = vi.fn();
  const clientID = 'c1';
  const logContext = new LogContext('error');
  const pokeHandler = new PokeHandler(
    replicachePokeStub,
    onPokeErrorStub,
    clientID,
    logContext,
  );

  expect(rafStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke1',
    baseCookie: 1,
    cookie: 2,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 1,
      c2: 2,
    },
    entitiesPatch: [{op: 'put', key: 'foo', value: 'foo1'}],
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 2,
    },
    entitiesPatch: [
      {op: 'put', key: 'foo', value: 'foo2'},
      {op: 'put', key: 'bar', value: 'bar1'},
    ],
  });

  expect(rafStub).toHaveBeenCalledTimes(0);
  pokeHandler.handlePokeEnd({pokeID: 'poke1'});

  expect(rafStub).toHaveBeenCalledTimes(1);
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);

  const rafCallback0 = rafStub.mock.calls[0][0];
  await rafCallback0(UNUSED_RAF_ARG);

  expect(replicachePokeStub).toHaveBeenCalledTimes(1);
  const replicachePoke0 = replicachePokeStub.mock.calls[0][0];
  expect(replicachePoke0).to.deep.equal({
    baseCookie: 1,
    pullResponse: {
      cookie: 2,
      lastMutationIDChanges: {
        c1: 2,
        c2: 2,
      },
      patch: [
        {op: 'put', key: 'e/foo', value: 'foo1'},
        {op: 'put', key: 'e/foo', value: 'foo2'},
        {op: 'put', key: 'e/bar', value: 'bar1'},
      ],
    },
  });

  expect(rafStub).toHaveBeenCalledTimes(2);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke2',
    baseCookie: 2,
    cookie: 3,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke2',
    lastMutationIDChanges: {
      c1: 3,
    },
    entitiesPatch: [{op: 'put', key: 'baz', value: 'baz1'}],
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke2',
    lastMutationIDChanges: {
      c3: 1,
    },
    entitiesPatch: [{op: 'put', key: 'bar', value: 'bar2'}],
  });

  expect(rafStub).toHaveBeenCalledTimes(2);

  pokeHandler.handlePokeEnd({pokeID: 'poke2'});

  expect(rafStub).toHaveBeenCalledTimes(2);
  expect(replicachePokeStub).toHaveBeenCalledTimes(1);

  const rafCallback1 = rafStub.mock.calls[1][0];
  await rafCallback1(UNUSED_RAF_ARG);

  expect(replicachePokeStub).toHaveBeenCalledTimes(2);
  const replicachePoke1 = replicachePokeStub.mock.calls[1][0];
  expect(replicachePoke1).to.deep.equal({
    baseCookie: 2,
    pullResponse: {
      cookie: 3,
      lastMutationIDChanges: {
        c1: 3,
        c3: 1,
      },
      patch: [
        {op: 'put', key: 'e/baz', value: 'baz1'},
        {op: 'put', key: 'e/bar', value: 'bar2'},
      ],
    },
  });

  expect(rafStub).toHaveBeenCalledTimes(3);

  const rafCallback2 = rafStub.mock.calls[2][0];
  await rafCallback2(UNUSED_RAF_ARG);
  expect(replicachePokeStub).toHaveBeenCalledTimes(2);
  expect(rafStub).toHaveBeenCalledTimes(3);
});

suite('onPokeErrors', () => {
  const cases: {
    name: string;
    causeError: (pokeHandler: PokeHandler) => void;
  }[] = [
    {
      name: 'pokePart before pokeStart',
      causeError: pokeHandler => {
        pokeHandler.handlePokePart({pokeID: 'poke1'});
      },
    },
    {
      name: 'pokeEnd before pokeStart',
      causeError: pokeHandler => {
        pokeHandler.handlePokeEnd({pokeID: 'poke1'});
      },
    },
    {
      name: 'pokePart with wrong pokeID',
      causeError: pokeHandler => {
        pokeHandler.handlePokeStart({
          pokeID: 'poke1',
          baseCookie: 1,
          cookie: 2,
        });
        pokeHandler.handlePokePart({pokeID: 'poke2'});
      },
    },
    {
      name: 'pokeEnd with wrong pokeID',
      causeError: pokeHandler => {
        pokeHandler.handlePokeStart({
          pokeID: 'poke1',
          baseCookie: 1,
          cookie: 2,
        });
        pokeHandler.handlePokeEnd({pokeID: 'poke2'});
      },
    },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const onPokeErrorStub = vi.fn();
      const replicachePokeStub = vi.fn();
      const clientID = 'c1';
      const logContext = new LogContext('error');
      const pokeHandler = new PokeHandler(
        replicachePokeStub,
        onPokeErrorStub,
        clientID,
        logContext,
      );

      expect(onPokeErrorStub).toHaveBeenCalledTimes(0);
      c.causeError(pokeHandler);
      expect(onPokeErrorStub).toHaveBeenCalledTimes(1);
    });
  }
});

test('replicachePoke throwing error calls onPokeError and clears', async () => {
  const onPokeErrorStub = vi.fn();
  const replicachePokeStub = vi.fn();
  const clientID = 'c1';
  const logContext = new LogContext('error');
  const pokeHandler = new PokeHandler(
    replicachePokeStub,
    onPokeErrorStub,
    clientID,
    logContext,
  );
  expect(rafStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke1',
    baseCookie: 1,
    cookie: 2,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 1,
      c2: 2,
    },
    entitiesPatch: [{op: 'put', key: 'foo', value: 'foo1'}],
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 2,
    },
    entitiesPatch: [
      {op: 'put', key: 'foo', value: 'foo2'},
      {op: 'put', key: 'bar', value: 'bar1'},
    ],
  });

  expect(rafStub).toHaveBeenCalledTimes(0);

  pokeHandler.handlePokeEnd({pokeID: 'poke1'});

  expect(rafStub).toHaveBeenCalledTimes(1);
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);

  const {promise, reject} = resolver();
  replicachePokeStub.mockReturnValue(promise);
  expect(onPokeErrorStub).toHaveBeenCalledTimes(0);

  const rafCallback0 = rafStub.mock.calls[0][0];
  const rafCallback0Result = rafCallback0(UNUSED_RAF_ARG);

  expect(onPokeErrorStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke2',
    baseCookie: 2,
    cookie: 3,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke2',
    lastMutationIDChanges: {
      c1: 3,
    },
    entitiesPatch: [{op: 'put', key: 'baz', value: 'baz1'}],
  });
  pokeHandler.handlePokeEnd({
    pokeID: 'poke2',
  });

  reject('error in poke');
  await rafCallback0Result;

  expect(replicachePokeStub).toHaveBeenCalledTimes(1);
  expect(rafStub).toHaveBeenCalledTimes(2);

  expect(onPokeErrorStub).toHaveBeenCalledTimes(1);

  const rafCallback1 = rafStub.mock.calls[1][0];
  await rafCallback1(UNUSED_RAF_ARG);
  // poke 2 cleared so replicachePokeStub not called
  expect(replicachePokeStub).toHaveBeenCalledTimes(1);
  expect(rafStub).toHaveBeenCalledTimes(2);
});

test('cookie gap during mergePoke calls onPokeError and clears', async () => {
  const onPokeErrorStub = vi.fn();
  const replicachePokeStub = vi.fn();
  const clientID = 'c1';
  const logContext = new LogContext('error');
  const pokeHandler = new PokeHandler(
    replicachePokeStub,
    onPokeErrorStub,
    clientID,
    logContext,
  );
  expect(rafStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke1',
    baseCookie: 1,
    cookie: 2,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 1,
      c2: 2,
    },
    entitiesPatch: [{op: 'put', key: 'foo', value: 'foo1'}],
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 2,
    },
    entitiesPatch: [
      {op: 'put', key: 'foo', value: 'foo2'},
      {op: 'put', key: 'bar', value: 'bar1'},
    ],
  });

  expect(rafStub).toHaveBeenCalledTimes(0);

  pokeHandler.handlePokeEnd({pokeID: 'poke1'});

  expect(rafStub).toHaveBeenCalledTimes(1);
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke2',
    baseCookie: 3, // gap, should be 2
    cookie: 4,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke2',
    lastMutationIDChanges: {
      c1: 2,
    },
  });

  pokeHandler.handlePokeEnd({pokeID: 'poke2'});

  expect(rafStub).toHaveBeenCalledTimes(1);
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);

  expect(onPokeErrorStub).toHaveBeenCalledTimes(0);

  const rafCallback0 = rafStub.mock.calls[0][0];
  const rafCallback0Result = rafCallback0(UNUSED_RAF_ARG);

  expect(onPokeErrorStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke3',
    baseCookie: 4,
    cookie: 5,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke3',
    lastMutationIDChanges: {
      c1: 3,
    },
    entitiesPatch: [{op: 'put', key: 'baz', value: 'baz1'}],
  });
  pokeHandler.handlePokeEnd({
    pokeID: 'poke3',
  });
  await rafCallback0Result;

  // not called because error is in merge before call
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);
  expect(rafStub).toHaveBeenCalledTimes(2);

  expect(onPokeErrorStub).toHaveBeenCalledTimes(1);

  const rafCallback1 = rafStub.mock.calls[1][0];
  await rafCallback1(UNUSED_RAF_ARG);
  // poke 3 cleared so replicachePokeStub not called
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);
  expect(rafStub).toHaveBeenCalledTimes(2);
});

test('onDisconnect clears pending pokes', async () => {
  const onPokeErrorStub = vi.fn();
  const replicachePokeStub = vi.fn();
  const clientID = 'c1';
  const logContext = new LogContext('error');
  const pokeHandler = new PokeHandler(
    replicachePokeStub,
    onPokeErrorStub,
    clientID,
    logContext,
  );
  expect(rafStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke1',
    baseCookie: 1,
    cookie: 2,
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 1,
      c2: 2,
    },
    entitiesPatch: [{op: 'put', key: 'foo', value: 'foo1'}],
  });
  pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 2,
    },
    entitiesPatch: [
      {op: 'put', key: 'foo', value: 'foo2'},
      {op: 'put', key: 'bar', value: 'bar1'},
    ],
  });

  expect(rafStub).toHaveBeenCalledTimes(0);

  pokeHandler.handlePokeEnd({pokeID: 'poke1'});

  expect(rafStub).toHaveBeenCalledTimes(1);
  expect(replicachePokeStub).toHaveBeenCalledTimes(0);

  pokeHandler.handleDisconnect();

  const rafCallback0 = rafStub.mock.calls[0][0];
  await rafCallback0(UNUSED_RAF_ARG);

  expect(replicachePokeStub).toHaveBeenCalledTimes(0);
  expect(rafStub).toHaveBeenCalledTimes(1);
});

test('handlePoke returns the last mutation id change for this client from pokePart or undefined if none or error', async () => {
  const onPokeErrorStub = vi.fn();
  const replicachePokeStub = vi.fn();
  const clientID = 'c1';
  const logContext = new LogContext('error');
  const pokeHandler = new PokeHandler(
    replicachePokeStub,
    onPokeErrorStub,
    clientID,
    logContext,
  );
  expect(rafStub).toHaveBeenCalledTimes(0);

  await pokeHandler.handlePokeStart({
    pokeID: 'poke1',
    baseCookie: 1,
    cookie: 2,
  });
  const lastMutationIDChangeForSelf0 = pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c1: 4,
      c2: 2,
    },
    entitiesPatch: [{op: 'put', key: 'foo', value: 'foo1'}],
  });
  expect(lastMutationIDChangeForSelf0).equals(4);
  const lastMutationIDChangeForSelf1 = pokeHandler.handlePokePart({
    pokeID: 'poke1',
    lastMutationIDChanges: {
      c2: 3,
    },
    entitiesPatch: [
      {op: 'put', key: 'foo', value: 'foo2'},
      {op: 'put', key: 'bar', value: 'bar1'},
    ],
  });
  expect(lastMutationIDChangeForSelf1).to.be.undefined;
  // error wrong pokeID
  const lastMutationIDChangeForSelf2 = pokeHandler.handlePokePart({
    pokeID: 'poke2',
    lastMutationIDChanges: {
      c1: 5,
    },
    entitiesPatch: [
      {op: 'put', key: 'foo', value: 'foo2'},
      {op: 'put', key: 'bar', value: 'bar1'},
    ],
  });
  expect(lastMutationIDChangeForSelf2).to.be.undefined;
});

test('mergePokes with empty array returns undefined', () => {
  const merged = mergePokes([]);
  expect(merged).to.be.undefined;
});

test('mergePokes with all optionals defined', () => {
  const result = mergePokes([
    {
      pokeStart: {
        pokeID: 'poke1',
        baseCookie: 3,
        cookie: 4,
      },
      parts: [
        {
          pokeID: 'poke1',
          lastMutationIDChanges: {c1: 1, c2: 2},
          clientsPatch: [{op: 'put', clientID: 'c2'}],
          desiredQueriesPatches: {
            c1: [
              {
                op: 'put',
                hash: 'h1',
                ast: {
                  table: 'issues',
                  select: [
                    ['id', 'id'],
                    ['name', 'name'],
                  ],
                  orderBy: [['id'], 'asc'],
                },
              },
            ],
          },
          gotQueriesPatch: [
            {
              op: 'put',
              hash: 'h1',
              ast: {
                table: 'issues',
                select: [
                  ['id', 'id'],
                  ['name', 'name'],
                ],
                orderBy: [['id'], 'asc'],
              },
            },
          ],
          entitiesPatch: [
            {op: 'put', key: 'foo', value: 'foo1'},
            {op: 'put', key: 'bar', value: 'bar1'},
          ],
        },

        {
          pokeID: 'poke1',
          lastMutationIDChanges: {c2: 3, c3: 4},
          clientsPatch: [{op: 'put', clientID: 'c3'}],
          desiredQueriesPatches: {
            c1: [
              {
                op: 'put',
                hash: 'h2',
                ast: {
                  table: 'labels',
                  select: [
                    ['id', 'id'],
                    ['name', 'name'],
                  ],
                  orderBy: [['id'], 'asc'],
                },
              },
            ],
          },
          gotQueriesPatch: [
            {
              op: 'put',
              hash: 'h2',
              ast: {
                table: 'labels',
                select: [
                  ['id', 'id'],
                  ['name', 'name'],
                ],
                orderBy: [['id'], 'asc'],
              },
            },
          ],
          entitiesPatch: [{op: 'put', key: 'baz', value: 'baz1'}],
        },
      ],
    },
    {
      pokeStart: {
        pokeID: 'poke2',
        baseCookie: 4,
        cookie: 5,
      },
      parts: [
        {
          pokeID: 'poke2',
          lastMutationIDChanges: {c4: 3},
          clientsPatch: [
            {op: 'del', clientID: 'c2'},
            {op: 'put', clientID: 'c4'},
          ],
          desiredQueriesPatches: {
            c1: [
              {
                op: 'del',
                hash: 'h1',
              },
            ],
          },
          gotQueriesPatch: [
            {
              op: 'del',
              hash: 'h1',
            },
          ],
          entitiesPatch: [{op: 'del', key: 'baz'}],
        },
      ],
    },
  ]);

  expect(result).toEqual({
    baseCookie: 3,
    pullResponse: {
      cookie: 5,
      lastMutationIDChanges: {
        c1: 1,
        c2: 3,
        c3: 4,
        c4: 3,
      },
      patch: [
        {
          op: 'put',
          key: 'c/c2',
          value: true,
        },
        {
          op: 'put',
          key: 'd/c1/h1',
          value: {
            table: 'issues',
            select: [
              ['id', 'id'],
              ['name', 'name'],
            ],
            orderBy: [['id'], 'asc'],
          },
        },
        {
          op: 'put',
          key: 'g/h1',
          value: {
            table: 'issues',
            select: [
              ['id', 'id'],
              ['name', 'name'],
            ],
            orderBy: [['id'], 'asc'],
          },
        },
        {
          op: 'put',
          key: 'e/foo',
          value: 'foo1',
        },
        {
          op: 'put',
          key: 'e/bar',
          value: 'bar1',
        },
        {
          op: 'put',
          key: 'c/c3',
          value: true,
        },
        {
          op: 'put',
          key: 'd/c1/h2',
          value: {
            table: 'labels',
            select: [
              ['id', 'id'],
              ['name', 'name'],
            ],
            orderBy: [['id'], 'asc'],
          },
        },
        {
          op: 'put',
          key: 'g/h2',
          value: {
            table: 'labels',
            select: [
              ['id', 'id'],
              ['name', 'name'],
            ],
            orderBy: [['id'], 'asc'],
          },
        },
        {
          op: 'put',
          key: 'e/baz',
          value: 'baz1',
        },
        {
          op: 'del',
          key: 'c/c2',
        },
        {
          op: 'put',
          key: 'c/c4',
          value: true,
        },
        {
          op: 'del',
          key: 'd/c1/h1',
        },
        {
          op: 'del',
          key: 'g/h1',
        },
        {
          op: 'del',
          key: 'e/baz',
        },
      ],
    },
  });
});

test('mergePokes sparse', () => {
  const result = mergePokes([
    {
      pokeStart: {
        pokeID: 'poke1',
        baseCookie: 3,
        cookie: 4,
      },
      parts: [
        {
          pokeID: 'poke1',
          lastMutationIDChanges: {c1: 1, c2: 2},
          gotQueriesPatch: [
            {
              op: 'put',
              hash: 'h1',
              ast: {
                table: 'issues',
                select: [
                  ['id', 'id'],
                  ['name', 'name'],
                ],
                orderBy: [['id'], 'asc'],
              },
            },
          ],
          entitiesPatch: [
            {op: 'put', key: 'foo', value: 'foo1'},
            {op: 'put', key: 'bar', value: 'bar1'},
          ],
        },

        {
          pokeID: 'poke1',
          clientsPatch: [{op: 'put', clientID: 'c3'}],
          desiredQueriesPatches: {
            c1: [
              {
                op: 'put',
                hash: 'h2',
                ast: {
                  table: 'labels',
                  select: [
                    ['id', 'id'],
                    ['name', 'name'],
                  ],
                  orderBy: [['id'], 'asc'],
                },
              },
            ],
          },
        },
      ],
    },
    {
      pokeStart: {
        pokeID: 'poke2',
        baseCookie: 4,
        cookie: 5,
      },
      parts: [
        {
          pokeID: 'poke2',
          clientsPatch: [
            {op: 'del', clientID: 'c2'},
            {op: 'put', clientID: 'c4'},
          ],
          desiredQueriesPatches: {
            c1: [
              {
                op: 'del',
                hash: 'h1',
              },
            ],
          },
          entitiesPatch: [{op: 'del', key: 'baz'}],
        },
      ],
    },
  ]);
  expect(result).toEqual({
    baseCookie: 3,
    pullResponse: {
      lastMutationIDChanges: {
        c1: 1,
        c2: 2,
      },
      patch: [
        {
          op: 'put',
          key: 'g/h1',
          value: {
            table: 'issues',
            select: [
              ['id', 'id'],
              ['name', 'name'],
            ],
            orderBy: [['id'], 'asc'],
          },
        },
        {
          op: 'put',
          key: 'e/foo',
          value: 'foo1',
        },
        {
          op: 'put',
          key: 'e/bar',
          value: 'bar1',
        },
        {
          op: 'put',
          key: 'c/c3',
          value: true,
        },
        {
          op: 'put',
          key: 'd/c1/h2',
          value: {
            table: 'labels',
            select: [
              ['id', 'id'],
              ['name', 'name'],
            ],
            orderBy: [['id'], 'asc'],
          },
        },
        {
          op: 'del',
          key: 'c/c2',
        },
        {
          op: 'put',
          key: 'c/c4',
          value: true,
        },
        {
          op: 'del',
          key: 'd/c1/h1',
        },
        {
          op: 'del',
          key: 'e/baz',
        },
      ],
      cookie: 5,
    },
  });
});

test('mergePokes throws error on cookie gaps', () => {
  expect(() => {
    mergePokes([
      {
        pokeStart: {
          pokeID: 'poke1',
          baseCookie: 3,
          cookie: 4,
        },
        parts: [
          {
            pokeID: 'poke1',
            lastMutationIDChanges: {c1: 1, c2: 2},
          },
        ],
      },
      {
        pokeStart: {
          pokeID: 'poke2',
          baseCookie: 5, // gap, should be 4
          cookie: 6,
        },
        parts: [
          {
            pokeID: 'poke2',
            lastMutationIDChanges: {c4: 3},
          },
        ],
      },
    ]);
  }).to.throw();
});