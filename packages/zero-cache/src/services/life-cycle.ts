import {LogContext} from '@rocicorp/logger';
import {resolver} from '@rocicorp/resolver';
import {pid} from 'node:process';
import type {EventEmitter} from 'stream';
import {
  singleProcessMode,
  type Subprocess,
  type Worker,
} from '../types/processes.ts';
import {RunningState} from './running-state.ts';
import type {SingletonService} from './service.ts';

/**
 * * `user-facing` workers serve external requests and are the first to
 *   receive a `SIGTERM` or `SIGINT` signal for graceful shutdown.
 *
 * * `supporting` workers support `user-facing` workers and are sent
 *   the `SIGTERM` signal only after all `user-facing` workers have
 *   exited.
 *
 * For other kill signals, such as `SIGQUIT`, all workers
 * are stopped without draining. Additionally, if any worker exits
 * unexpectedly, all workers sent an immediate `SIGQUIT` signal.
 */
export type WorkerType = 'user-facing' | 'supporting';

export const GRACEFUL_SHUTDOWN = ['SIGTERM', 'SIGINT'] as const;
export const FORCEFUL_SHUTDOWN = ['SIGQUIT'] as const;

/**
 * Handles readiness, termination signals, and coordination of graceful
 * shutdown.
 */
export class ProcessManager {
  readonly #lc: LogContext;
  readonly #userFacing = new Set<Subprocess>();
  readonly #all = new Set<Subprocess>();
  readonly #exitImpl: (code: number) => never;
  readonly #start = Date.now();
  readonly #ready: Promise<void>[] = [];

  #runningState = new RunningState('process-manager');
  #drainStart = 0;

  constructor(lc: LogContext, proc: EventEmitter = process) {
    this.#lc = lc.withContext('component', 'process-manager');

    // Propagate `SIGTERM` and `SIGINT` to all user-facing workers,
    // initiating a graceful shutdown. The parent process will
    // exit once all user-facing workers have exited ...
    for (const signal of GRACEFUL_SHUTDOWN) {
      proc.on(signal, () => this.#startDrain(signal));
    }

    // ... which will result in sending `SIGTERM` to the remaining workers.
    proc.on('exit', code =>
      this.#kill(
        this.#all,
        code === 0 ? GRACEFUL_SHUTDOWN[0] : FORCEFUL_SHUTDOWN[0],
      ),
    );

    // For other (catchable) kill signals, exit with a non-zero error code
    // to send a `SIGQUIT` to all workers. For this signal, workers are
    // stopped immediately without draining. See `runUntilKilled()`.
    for (const signal of FORCEFUL_SHUTDOWN) {
      proc.on(signal, () => this.#exit(-1));
    }

    this.#exitImpl = (code: number) => {
      if (singleProcessMode()) {
        return proc.emit('exit', code) as never; // For unit / integration tests.
      }
      process.exit(code);
    };
  }

  done() {
    return this.#runningState.stopped();
  }

  #exit(code: number) {
    this.#lc.info?.('exiting with code', code);
    this.#runningState.stop(this.#lc);
    void this.#lc.flush().finally(() => this.#exitImpl(code));
  }

  #startDrain(signal: 'SIGTERM' | 'SIGINT' = 'SIGTERM') {
    this.#lc.info?.(`initiating drain (${signal})`);
    this.#drainStart = Date.now();
    if (this.#userFacing.size) {
      this.#kill(this.#userFacing, signal);
    } else {
      this.#kill(this.#all, signal);
    }
  }

  addSubprocess(proc: Subprocess, type: WorkerType, name: string) {
    if (type === 'user-facing') {
      this.#userFacing.add(proc);
    }
    this.#all.add(proc);

    proc.on(
      'error',
      err => this.#lc.error?.(`error from ${name} ${proc.pid}`, err),
    );
    proc.on('close', (code, signal) =>
      this.#onExit(code, signal, null, type, name, proc),
    );
  }

  addWorker(worker: Worker, type: WorkerType, name: string): Worker {
    this.addSubprocess(worker, type, name);

    const {promise, resolve} = resolver();
    this.#ready.push(promise);
    worker.onceMessageType('ready', () => {
      this.#lc.debug?.(`${name} ready (${Date.now() - this.#start} ms)`);
      resolve();
    });

    return worker;
  }

  async allWorkersReady() {
    await Promise.all(this.#ready);
  }

  logErrorAndExit(err: unknown, name: string) {
    // only accessible by the main (i.e. user-facing) process.
    this.#onExit(-1, null, err, 'user-facing', name, undefined);
  }

  #onExit(
    code: number,
    sig: NodeJS.Signals | null,
    err: unknown | null,
    type: WorkerType,
    name: string,
    worker: Subprocess | undefined,
  ) {
    // Remove the worker from maps to avoid attempting to send more signals to it.
    if (worker) {
      this.#userFacing.delete(worker);
      this.#all.delete(worker);
    }

    const pid = worker?.pid ?? process.pid;

    if (type === 'supporting') {
      // The replication-manager has no user-facing workers.
      // In this case, code === 0 shutdowns are not errors.
      const log = code === 0 && this.#userFacing.size === 0 ? 'info' : 'error';
      this.#lc[log]?.(`${name} (${pid}) exited with code (${code})`, err ?? '');
      return this.#exit(log === 'error' ? -1 : code);
    }

    const log = this.#drainStart === 0 ? 'error' : 'warn';
    if (sig) {
      this.#lc[log]?.(`${name} (${pid}) killed with (${sig})`, err ?? '');
    } else if (code !== 0) {
      this.#lc[log]?.(`${name} (${pid}) exited with code (${code})`, err ?? '');
    } else {
      this.#lc.info?.(`${name} (${pid}) exited with code (${code})`);
    }

    // user-facing workers exited or finished draining.
    if (this.#userFacing.size === 0) {
      this.#lc.info?.(
        this.#drainStart
          ? `all user-facing workers drained (${
              Date.now() - this.#drainStart
            } ms)`
          : `all user-facing workers exited`,
      );
      return this.#exit(0);
    }

    // Exit only if not draining. If a user-facing worker exits unexpectedly
    // during a drain, log a warning but let other user-facing workers drain.
    if (log === 'error') {
      return this.#exit(code || -1);
    }

    return undefined;
  }

  #kill(workers: Iterable<Subprocess>, signal: NodeJS.Signals) {
    for (const worker of workers) {
      try {
        worker.kill(signal);
      } catch (e) {
        this.#lc.error?.(e);
      }
    }
  }
}

/**
 * Runs the specified services, stopping them on `SIGTERM` or `SIGINT` with
 * an optional {@link SingletonService.drain drain()}, or stopping them
 * without draining for `SIGQUIT`.
 *
 * @returns a Promise that resolves/rejects when any of the services stops/throws.
 */

export async function runUntilKilled(
  lc: LogContext,
  parent: Worker | NodeJS.Process,
  ...services: SingletonService[]
): Promise<void> {
  if (services.length === 0) {
    return;
  }
  for (const signal of [...GRACEFUL_SHUTDOWN, ...FORCEFUL_SHUTDOWN]) {
    parent.once(signal, () => {
      const GRACEFUL_SIGNALS = GRACEFUL_SHUTDOWN as readonly NodeJS.Signals[];

      services.forEach(async svc => {
        if (GRACEFUL_SIGNALS.includes(signal) && svc.drain) {
          lc.info?.(`draining ${svc.constructor.name} ${svc.id} (${signal})`);
          await svc.drain();
        }
        lc.info?.(`stopping ${svc.constructor.name} ${svc.id} (${signal})`);
        await svc.stop();
      });
    });
  }

  try {
    // Run all services and resolve when any of them stops.
    const svc = await Promise.race(
      services.map(svc => svc.run().then(() => svc)),
    );
    lc.info?.(`${svc.constructor.name} (${svc.id}) stopped`);
  } catch (e) {
    lc.error?.(`exiting on error`, e);
    throw e;
  }
}

export async function exitAfter(run: () => Promise<void>) {
  try {
    await run();
    // eslint-disable-next-line no-console
    console.info(`pid ${pid} exiting normally`);
    process.exit(0);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`pid ${pid} exiting with error`, e);
    process.exit(-1);
  }
}

const DEFAULT_STOP_INTERVAL_MS = 15_000;

/**
 * The HeartbeatMonitor monitors the cadence heartbeats (e.g. "/keepalive"
 * health checks made to HttpServices) that signal that the server
 * should continue processing requests. When a configurable `stopInterval`
 * elapses without receiving these heartbeats, the monitor initiates a
 * graceful shutdown of the server. This works with common load balancing
 * frameworks such as AWS Elastic Load Balancing.
 *
 * The HeartbeatMonitor is **opt-in** in that it only kicks in after it
 * starts receiving keepalives.
 */
export class HeartbeatMonitor {
  readonly #stopInterval: number;

  #lc: LogContext;
  #timer: NodeJS.Timeout | undefined;
  #lastHeartbeat = 0;

  constructor(lc: LogContext, stopInterval = DEFAULT_STOP_INTERVAL_MS) {
    this.#lc = lc;
    this.#stopInterval = stopInterval;
  }

  onHeartbeat() {
    this.#lastHeartbeat = Date.now();
    if (this.#timer === undefined) {
      this.#lc.info?.(
        `starting heartbeat monitor at ${
          this.#stopInterval / 1000
        } second interval`,
      );
      // e.g. check every 5 seconds to see if it's been over 15 seconds
      //      since the last heartbeat.
      this.#timer = setInterval(
        this.#checkStopInterval,
        this.#stopInterval / 3,
      );
    }
  }

  #checkStopInterval = () => {
    const timeSinceLastHeartbeat = Date.now() - this.#lastHeartbeat;
    if (timeSinceLastHeartbeat >= this.#stopInterval) {
      this.#lc.info?.(
        `last heartbeat received ${
          timeSinceLastHeartbeat / 1000
        } seconds ago. draining.`,
      );
      process.kill(process.pid, GRACEFUL_SHUTDOWN[0]);
    }
  };

  stop() {
    clearTimeout(this.#timer);
  }
}
