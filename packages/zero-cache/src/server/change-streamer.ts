import {assert} from '../../../shared/src/asserts.ts';
import {must} from '../../../shared/src/must.ts';
import {DatabaseInitError} from '../../../zqlite/src/db.ts';
import {getZeroConfig} from '../config/zero-config.ts';
import {deleteLiteDB} from '../db/delete-lite-db.ts';
import {initializeCustomChangeSource} from '../services/change-source/custom/change-source.ts';
import {initializePostgresChangeSource} from '../services/change-source/pg/change-source.ts';
import {ChangeStreamerHttpServer} from '../services/change-streamer/change-streamer-http.ts';
import {initializeStreamer} from '../services/change-streamer/change-streamer-service.ts';
import type {ChangeStreamerService} from '../services/change-streamer/change-streamer.ts';
import {AutoResetSignal} from '../services/change-streamer/schema/tables.ts';
import {exitAfter, runUntilKilled} from '../services/life-cycle.ts';
import {pgClient} from '../types/pg.ts';
import {
  parentWorker,
  singleProcessMode,
  type Worker,
} from '../types/processes.ts';
import {createLogContext} from './logging.ts';

export default async function runWorker(
  parent: Worker,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const config = getZeroConfig(env);
  const port = config.changeStreamerPort ?? config.port + 1;
  const lc = createLogContext(config, {worker: 'change-streamer'});

  // Kick off DB connection warmup in the background.
  const changeDB = pgClient(lc, config.change.db, {
    max: config.change.maxConns,
    connection: {['application_name']: 'zero-change-streamer'},
  });
  void Promise.allSettled(
    Array.from({length: config.change.maxConns}, () =>
      changeDB`SELECT 1`.simple().execute(),
    ),
  );

  const {autoReset} = config;
  let changeStreamer: ChangeStreamerService | undefined;

  for (const first of [true, false]) {
    try {
      // Note: This performs initial sync of the replica if necessary.
      const {changeSource, replicationConfig} =
        config.upstream.type === 'pg'
          ? await initializePostgresChangeSource(
              lc,
              config.upstream.db,
              config.shard,
              config.replicaFile,
              config.initialSync,
            )
          : await initializeCustomChangeSource(
              lc,
              config.upstream.db,
              config.shard,
              config.replicaFile,
            );

      changeStreamer = await initializeStreamer(
        lc,
        changeDB,
        changeSource,
        replicationConfig,
        autoReset ?? false,
      );
      break;
    } catch (e) {
      if (first && e instanceof AutoResetSignal) {
        lc.warn?.(`resetting replica ${config.replicaFile}`, e);
        // TODO: Make deleteLiteDB work with litestream. It will probably have to be
        //       a semantic wipe instead of a file delete.
        deleteLiteDB(config.replicaFile);
        continue; // execute again with a fresh initial-sync
      }
      if (e instanceof DatabaseInitError) {
        throw new Error(
          `Cannot open ZERO_REPLICA_FILE at "${config.replicaFile}". Please check that the path is valid.`,
          {cause: e},
        );
      }
      throw e;
    }
  }
  // impossible: upstream must have advanced in order for replication to be stuck.
  assert(changeStreamer, `resetting replica did not advance replicaVersion`);

  const changeStreamerWebServer = new ChangeStreamerHttpServer(
    lc,
    changeStreamer,
    {port},
    parent,
  );

  parent.send(['ready', {ready: true}]);

  return runUntilKilled(lc, parent, changeStreamer, changeStreamerWebServer);
}

// fork()
if (!singleProcessMode()) {
  void exitAfter(() => runWorker(must(parentWorker), process.env));
}
