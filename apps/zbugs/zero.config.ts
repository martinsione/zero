import process from 'node:process';
import 'dotenv/config';
import {defineConfig, Queries} from 'zero-cache/src/config/define-config.js';
import {must} from 'shared/src/must';
import {Schema, schema} from './src/domain/schema-shared';

type AuthData = {aud: string};

const allowIfCrewMember = (queries: Queries<Schema>) => (authData: AuthData) =>
  queries.user.where('id', '=', authData.aud).where('role', '=', 'crew');

defineConfig<AuthData, Schema>(schema, queries => ({
  upstreamUri: must(process.env.UPSTREAM_URI),
  cvrDbUri: must(process.env.CVR_DB_URI),
  changeDbUri: must(process.env.CHANGE_DB_URI),

  replicaId: must(process.env.REPLICA_ID),
  replicaDbFile: must(process.env.REPLICA_DB_FILE),

  log: {
    level: 'debug',
  },

  authorization: {
    user: {
      // Only the authentication system can
      // write to the user table.
      table: {
        delete: [],
        insert: [],
        update: [],
      },
    },
    issue: {
      row: {
        delete: [],
        update: [
          (authData, row) =>
            queries.issue
              .where('id', '=', row.id)
              .where('creatorID', '=', authData.aud),
          allowIfCrewMember(queries),
        ],
      },
    },
    comment: {
      row: {
        delete: [],
        update: [
          (authData, row) =>
            queries.comment
              .where('id', '=', row.id)
              .where('creatorID', '=', authData.aud),
        ],
      },
    },
  },
}));
