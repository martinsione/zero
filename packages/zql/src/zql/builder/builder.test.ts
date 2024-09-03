import {expect, test} from 'vitest';
import {Catch} from '../ivm/catch.js';
import {ChangeType} from '../ivm/change.js';
import {MemorySource} from '../ivm/memory-source.js';
import {MemoryStorage} from '../ivm/memory-storage.js';
import {buildPipeline} from './builder.js';

export function testSources() {
  const users = new MemorySource(
    'table',
    {id: {type: 'number'}, name: {type: 'string'}},
    ['id'],
  );
  users.push({
    type: ChangeType.Add,
    row: {id: 1, name: 'aaron', recruiterID: null},
  });
  users.push({
    type: ChangeType.Add,
    row: {id: 2, name: 'erik', recruiterID: 1},
  });
  users.push({
    type: ChangeType.Add,
    row: {id: 3, name: 'greg', recruiterID: 1},
  });
  users.push({
    type: ChangeType.Add,
    row: {id: 4, name: 'matt', recruiterID: 1},
  });
  users.push({
    type: ChangeType.Add,
    row: {id: 5, name: 'cesar', recruiterID: 3},
  });
  users.push({
    type: ChangeType.Add,
    row: {id: 6, name: 'darick', recruiterID: 3},
  });
  users.push({
    type: ChangeType.Add,
    row: {id: 7, name: 'alex', recruiterID: 1},
  });

  const states = new MemorySource('table', {code: {type: 'string'}}, ['code']);
  states.push({type: ChangeType.Add, row: {code: 'CA'}});
  states.push({type: ChangeType.Add, row: {code: 'HI'}});
  states.push({type: ChangeType.Add, row: {code: 'AZ'}});
  states.push({type: ChangeType.Add, row: {code: 'MD'}});
  states.push({type: ChangeType.Add, row: {code: 'GA'}});

  const userStates = new MemorySource(
    'table',
    {userID: {type: 'number'}, stateCode: {type: 'string'}},
    ['userID', 'stateCode'],
  );
  userStates.push({type: ChangeType.Add, row: {userID: 1, stateCode: 'HI'}});
  userStates.push({type: ChangeType.Add, row: {userID: 3, stateCode: 'AZ'}});
  userStates.push({type: ChangeType.Add, row: {userID: 3, stateCode: 'CA'}});
  userStates.push({type: ChangeType.Add, row: {userID: 4, stateCode: 'MD'}});
  userStates.push({type: ChangeType.Add, row: {userID: 5, stateCode: 'AZ'}});
  userStates.push({type: ChangeType.Add, row: {userID: 6, stateCode: 'CA'}});
  userStates.push({type: ChangeType.Add, row: {userID: 7, stateCode: 'GA'}});

  const sources = {users, userStates, states};

  function getSource(name: string) {
    return (sources as Record<string, MemorySource>)[name];
  }

  return {sources, getSource};
}

test('source-only', () => {
  const {sources, getSource} = testSources();
  const sink = new Catch(
    buildPipeline(
      {
        table: 'users',
        orderBy: [
          ['name', 'asc'],
          ['id', 'asc'],
        ],
      },
      {
        getSource,
        createStorage: () => new MemoryStorage(),
      },
    ),
  );

  expect(sink.fetch()).toEqual([
    {row: {id: 1, name: 'aaron', recruiterID: null}, relationships: {}},
    {row: {id: 7, name: 'alex', recruiterID: 1}, relationships: {}},
    {row: {id: 5, name: 'cesar', recruiterID: 3}, relationships: {}},
    {row: {id: 6, name: 'darick', recruiterID: 3}, relationships: {}},
    {row: {id: 2, name: 'erik', recruiterID: 1}, relationships: {}},
    {row: {id: 3, name: 'greg', recruiterID: 1}, relationships: {}},
    {row: {id: 4, name: 'matt', recruiterID: 1}, relationships: {}},
  ]);

  sources.users.push({type: ChangeType.Add, row: {id: 8, name: 'sam'}});
  expect(sink.pushes).toEqual([
    {
      type: ChangeType.Add,
      node: {row: {id: 8, name: 'sam'}, relationships: {}},
    },
  ]);
});

test('filter', () => {
  const {sources, getSource} = testSources();
  const sink = new Catch(
    buildPipeline(
      {
        table: 'users',
        orderBy: [['id', 'desc']],
        where: [
          {
            type: 'simple',
            field: 'name',
            op: '>=',
            value: 'c',
          },
        ],
      },
      {
        getSource,
        createStorage: () => new MemoryStorage(),
      },
    ),
  );

  expect(sink.fetch()).toEqual([
    {row: {id: 6, name: 'darick', recruiterID: 3}, relationships: {}},
    {row: {id: 5, name: 'cesar', recruiterID: 3}, relationships: {}},
    {row: {id: 4, name: 'matt', recruiterID: 1}, relationships: {}},
    {row: {id: 3, name: 'greg', recruiterID: 1}, relationships: {}},
    {row: {id: 2, name: 'erik', recruiterID: 1}, relationships: {}},
  ]);

  sources.users.push({type: ChangeType.Add, row: {id: 8, name: 'sam'}});
  sources.users.push({type: ChangeType.Add, row: {id: 9, name: 'abby'}});
  sources.users.push({type: ChangeType.Remove, row: {id: 8, name: 'sam'}});
  expect(sink.pushes).toEqual([
    {
      type: ChangeType.Add,
      node: {row: {id: 8, name: 'sam'}, relationships: {}},
    },
    {
      type: ChangeType.Remove,
      node: {row: {id: 8, name: 'sam'}, relationships: {}},
    },
  ]);
});

test('self-join', () => {
  const {sources, getSource} = testSources();
  const sink = new Catch(
    buildPipeline(
      {
        table: 'users',
        orderBy: [['id', 'asc']],
        related: [
          {
            correlation: {
              parentField: 'recruiterID',
              op: '=',
              childField: 'id',
            },
            subquery: {
              table: 'users',
              alias: 'recruiter',
              orderBy: [['id', 'asc']],
            },
          },
        ],
      },
      {
        getSource,
        createStorage: () => new MemoryStorage(),
      },
    ),
  );

  expect(sink.fetch()).toEqual([
    {
      row: {id: 1, name: 'aaron', recruiterID: null},
      relationships: {
        recruiter: [],
      },
    },
    {
      row: {id: 2, name: 'erik', recruiterID: 1},
      relationships: {
        recruiter: [
          {row: {id: 1, name: 'aaron', recruiterID: null}, relationships: {}},
        ],
      },
    },
    {
      row: {id: 3, name: 'greg', recruiterID: 1},
      relationships: {
        recruiter: [
          {row: {id: 1, name: 'aaron', recruiterID: null}, relationships: {}},
        ],
      },
    },
    {
      row: {id: 4, name: 'matt', recruiterID: 1},
      relationships: {
        recruiter: [
          {row: {id: 1, name: 'aaron', recruiterID: null}, relationships: {}},
        ],
      },
    },
    {
      row: {id: 5, name: 'cesar', recruiterID: 3},
      relationships: {
        recruiter: [
          {row: {id: 3, name: 'greg', recruiterID: 1}, relationships: {}},
        ],
      },
    },
    {
      row: {id: 6, name: 'darick', recruiterID: 3},
      relationships: {
        recruiter: [
          {row: {id: 3, name: 'greg', recruiterID: 1}, relationships: {}},
        ],
      },
    },
    {
      row: {id: 7, name: 'alex', recruiterID: 1},
      relationships: {
        recruiter: [
          {row: {id: 1, name: 'aaron', recruiterID: null}, relationships: {}},
        ],
      },
    },
  ]);

  sources.users.push({
    type: ChangeType.Add,
    row: {id: 8, name: 'sam', recruiterID: 2},
  });
  sources.users.push({
    type: ChangeType.Add,
    row: {id: 9, name: 'abby', recruiterID: 8},
  });
  sources.users.push({
    type: ChangeType.Remove,
    row: {id: 8, name: 'sam', recruiterID: 2},
  });
  sources.users.push({
    type: ChangeType.Add,
    row: {id: 8, name: 'sam', recruiterID: 3},
  });

  expect(sink.pushes).toEqual([
    {
      type: ChangeType.Add,
      node: {
        row: {id: 8, name: 'sam', recruiterID: 2},
        relationships: {
          recruiter: [
            {row: {id: 2, name: 'erik', recruiterID: 1}, relationships: {}},
          ],
        },
      },
    },
    {
      type: ChangeType.Add,
      node: {
        row: {id: 9, name: 'abby', recruiterID: 8},
        relationships: {
          recruiter: [
            {row: {id: 8, name: 'sam', recruiterID: 2}, relationships: {}},
          ],
        },
      },
    },
    {
      type: ChangeType.Remove,
      node: {
        row: {id: 8, name: 'sam', recruiterID: 2},
        relationships: {
          recruiter: [
            {row: {id: 2, name: 'erik', recruiterID: 1}, relationships: {}},
          ],
        },
      },
    },
    {
      type: ChangeType.Child,
      row: {id: 9, name: 'abby', recruiterID: 8},
      child: {
        relationshipName: 'recruiter',
        change: {
          type: ChangeType.Remove,
          node: {row: {id: 8, name: 'sam', recruiterID: 2}, relationships: {}},
        },
      },
    },
    {
      type: ChangeType.Add,
      node: {
        row: {id: 8, name: 'sam', recruiterID: 3},
        relationships: {
          recruiter: [
            {row: {id: 3, name: 'greg', recruiterID: 1}, relationships: {}},
          ],
        },
      },
    },
    {
      type: ChangeType.Child,
      row: {id: 9, name: 'abby', recruiterID: 8},
      child: {
        relationshipName: 'recruiter',
        change: {
          type: ChangeType.Add,
          node: {row: {id: 8, name: 'sam', recruiterID: 3}, relationships: {}},
        },
      },
    },
  ]);
});

test('multi-join', () => {
  const {sources, getSource} = testSources();
  const sink = new Catch(
    buildPipeline(
      {
        table: 'users',
        orderBy: [['id', 'asc']],
        where: [
          {
            type: 'simple',
            field: 'id',
            op: '<=',
            value: 3,
          },
        ],
        related: [
          {
            correlation: {
              parentField: 'id',
              op: '=',
              childField: 'userID',
            },
            subquery: {
              table: 'userStates',
              alias: 'userStates',
              orderBy: [
                ['userID', 'asc'],
                ['stateCode', 'asc'],
              ],
              related: [
                {
                  correlation: {
                    parentField: 'stateCode',
                    op: '=',
                    childField: 'code',
                  },
                  subquery: {
                    table: 'states',
                    alias: 'states',
                    orderBy: [['code', 'asc']],
                  },
                },
              ],
            },
          },
        ],
      },
      {
        getSource,
        createStorage: () => new MemoryStorage(),
      },
    ),
  );

  expect(sink.fetch()).toEqual([
    {
      row: {id: 1, name: 'aaron', recruiterID: null},
      relationships: {
        userStates: [
          {
            row: {userID: 1, stateCode: 'HI'},
            relationships: {
              states: [{row: {code: 'HI'}, relationships: {}}],
            },
          },
        ],
      },
    },
    {
      row: {id: 2, name: 'erik', recruiterID: 1},
      relationships: {
        userStates: [],
      },
    },
    {
      row: {id: 3, name: 'greg', recruiterID: 1},
      relationships: {
        userStates: [
          {
            row: {userID: 3, stateCode: 'AZ'},
            relationships: {
              states: [{row: {code: 'AZ'}, relationships: {}}],
            },
          },
          {
            row: {userID: 3, stateCode: 'CA'},
            relationships: {
              states: [{row: {code: 'CA'}, relationships: {}}],
            },
          },
        ],
      },
    },
  ]);

  sources.userStates.push({
    type: ChangeType.Add,
    row: {userID: 2, stateCode: 'HI'},
  });

  expect(sink.pushes).toEqual([
    {
      type: ChangeType.Child,
      row: {id: 2, name: 'erik', recruiterID: 1},
      child: {
        relationshipName: 'userStates',
        change: {
          type: ChangeType.Add,
          node: {
            row: {userID: 2, stateCode: 'HI'},
            relationships: {
              states: [{row: {code: 'HI'}, relationships: {}}],
            },
          },
        },
      },
    },
  ]);
});

test('join with limit', () => {
  const {sources, getSource} = testSources();
  const sink = new Catch(
    buildPipeline(
      {
        table: 'users',
        orderBy: [['id', 'asc']],
        limit: 3,
        related: [
          {
            correlation: {
              parentField: 'id',
              op: '=',
              childField: 'userID',
            },
            subquery: {
              table: 'userStates',
              alias: 'userStates',
              orderBy: [
                ['userID', 'asc'],
                ['stateCode', 'asc'],
              ],
              limit: 1,
              related: [
                {
                  correlation: {
                    parentField: 'stateCode',
                    op: '=',
                    childField: 'code',
                  },
                  subquery: {
                    table: 'states',
                    alias: 'states',
                    orderBy: [['code', 'asc']],
                  },
                },
              ],
            },
          },
        ],
      },
      {
        getSource,
        createStorage: () => new MemoryStorage(),
      },
    ),
  );

  expect(sink.fetch()).toEqual([
    {
      row: {id: 1, name: 'aaron', recruiterID: null},
      relationships: {
        userStates: [
          {
            row: {userID: 1, stateCode: 'HI'},
            relationships: {
              states: [{row: {code: 'HI'}, relationships: {}}],
            },
          },
        ],
      },
    },
    {
      row: {id: 2, name: 'erik', recruiterID: 1},
      relationships: {
        userStates: [],
      },
    },
    {
      row: {id: 3, name: 'greg', recruiterID: 1},
      relationships: {
        userStates: [
          {
            row: {userID: 3, stateCode: 'AZ'},
            relationships: {
              states: [{row: {code: 'AZ'}, relationships: {}}],
            },
          },
        ],
      },
    },
  ]);

  sources.userStates.push({
    type: ChangeType.Add,
    row: {userID: 2, stateCode: 'HI'},
  });

  expect(sink.pushes).toEqual([
    {
      type: ChangeType.Child,
      row: {id: 2, name: 'erik', recruiterID: 1},
      child: {
        relationshipName: 'userStates',
        change: {
          type: ChangeType.Add,
          node: {
            row: {userID: 2, stateCode: 'HI'},
            relationships: {
              states: [{row: {code: 'HI'}, relationships: {}}],
            },
          },
        },
      },
    },
  ]);
});

test('skip', () => {
  const {sources, getSource} = testSources();
  const sink = new Catch(
    buildPipeline(
      {
        table: 'users',
        orderBy: [['id', 'asc']],
        start: {row: {id: 3}, exclusive: true},
      },
      {
        getSource,
        createStorage: () => new MemoryStorage(),
      },
    ),
  );

  expect(sink.fetch()).toEqual([
    {row: {id: 4, name: 'matt', recruiterID: 1}, relationships: {}},
    {row: {id: 5, name: 'cesar', recruiterID: 3}, relationships: {}},
    {row: {id: 6, name: 'darick', recruiterID: 3}, relationships: {}},
    {row: {id: 7, name: 'alex', recruiterID: 1}, relationships: {}},
  ]);

  sources.users.push({type: ChangeType.Add, row: {id: 8, name: 'sam'}});
  expect(sink.pushes).toEqual([
    {
      type: ChangeType.Add,
      node: {row: {id: 8, name: 'sam'}, relationships: {}},
    },
  ]);
});
