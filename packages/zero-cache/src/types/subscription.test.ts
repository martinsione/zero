import {sleep} from 'shared/src/sleep.js';
import {describe, expect, test, vi} from 'vitest';
import {Subscription} from './subscription.js';

describe('types/subscription', () => {
  test('cancel', async () => {
    const consumed = new Set<number>();
    const cleanup = vi.fn();

    const subscription = new Subscription<number>({
      cleanup,
      consumed: m => consumed.add(m),
    });
    for (let i = 0; i < 5; i++) {
      subscription.push(i);
    }

    const received: number[] = [];

    let j = 0;
    for await (const m of subscription) {
      expect(consumed.has(m)).toBe(false);
      for (let i = 0; i < m; i++) {
        expect(consumed.has(i)).toBe(true);
      }
      received.push(m);
      if (j++ === 2) {
        subscription.cancel();
      }
    }

    expect(received).toEqual([0, 1, 2]);
    expect(consumed).toEqual(new Set(received));
    expect(cleanup).toBeCalledTimes(1);
    expect(cleanup.mock.calls[0][0]).toEqual([3, 4]);
  });

  test('fail', async () => {
    const consumed = new Set<number>();
    const cleanup = vi.fn();

    const subscription = new Subscription<number>({
      cleanup,
      consumed: m => consumed.add(m),
    });
    for (let i = 0; i < 5; i++) {
      subscription.push(i);
    }

    const received: number[] = [];
    const failure = new Error('boo');
    let caught;
    let j = 0;
    try {
      for await (const m of subscription) {
        expect(consumed.has(m)).toBe(false);
        for (let i = 0; i < m; i++) {
          expect(consumed.has(i)).toBe(true);
        }
        received.push(m);
        if (j++ === 2) {
          subscription.fail(failure);
        }
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(failure);
    expect(received).toEqual([0, 1, 2]);
    expect(consumed).toEqual(new Set(received));
    expect(cleanup).toBeCalledTimes(1);
    expect(cleanup.mock.calls[0][0]).toEqual([3, 4]);
  });

  test('iteration break', async () => {
    const consumed = new Set<number>();
    const cleanup = vi.fn();

    const subscription = new Subscription<number>({
      cleanup,
      consumed: m => consumed.add(m),
    });
    for (let i = 0; i < 5; i++) {
      subscription.push(i);
    }

    const received: number[] = [];
    let j = 0;
    for await (const m of subscription) {
      expect(consumed.has(m)).toBe(false);
      for (let i = 0; i < m; i++) {
        expect(consumed.has(i)).toBe(true);
      }
      received.push(m);
      if (j++ === 2) {
        break;
      }
    }

    expect(received).toEqual([0, 1, 2]);
    expect(consumed).toEqual(new Set(received));
    expect(cleanup).toBeCalledTimes(1);
    expect(cleanup.mock.calls[0][0]).toEqual([3, 4]);
  });

  test('iteration throw', async () => {
    const consumed = new Set<number>();
    const cleanup = vi.fn();

    const subscription = new Subscription<number>({
      cleanup,
      consumed: m => consumed.add(m),
    });
    for (let i = 0; i < 5; i++) {
      subscription.push(i);
    }

    const received: number[] = [];
    const failure = new Error('boo');
    let caught;
    let j = 0;
    try {
      for await (const m of subscription) {
        expect(consumed.has(m)).toBe(false);
        for (let i = 0; i < m; i++) {
          expect(consumed.has(i)).toBe(true);
        }
        received.push(m);
        if (j++ === 2) {
          throw failure;
        }
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(failure);
    expect(received).toEqual([0, 1, 2]);
    expect(consumed).toEqual(new Set(received));
    expect(cleanup).toBeCalledTimes(1);
    expect(cleanup.mock.calls[0][0]).toEqual([3, 4]);
  });

  test('pushed while iterating', async () => {
    const consumed = new Set<number>();
    const cleanup = vi.fn();

    const subscription = new Subscription<number>({
      cleanup,
      consumed: m => consumed.add(m),
    });

    // Start the iteration first.
    const received: number[] = [];
    const iteration = (async () => {
      let j = 0;
      for await (const m of subscription) {
        expect(consumed.has(m)).toBe(false);
        for (let i = 0; i < m; i++) {
          expect(consumed.has(i)).toBe(true);
        }
        received.push(m);
        if (j++ === 2) {
          subscription.cancel();
        }
      }
    })();

    // Now push messages into the subscription.
    for (let i = 0; i < 5; i++) {
      await sleep(2);
      subscription.push(i);
    }
    await iteration;

    expect(received).toEqual([0, 1, 2]);
    expect(consumed).toEqual(new Set(received));
    expect(cleanup).toBeCalledTimes(1);
  });

  test('coalesce cancel', async () => {
    const consumed = new Set<string>();
    const cleanup = vi.fn();

    const subscription = new Subscription<string>({
      cleanup,
      consumed: m => consumed.add(m),
      coalesce: (curr, prev) => `${prev},${curr}`,
    });
    subscription.push('a');
    subscription.push('b');

    const received: string[] = [];
    let i = 0;
    for await (const m of subscription) {
      received.push(m);

      if (i++ === 0) {
        expect(consumed.has('a,b')).toBe(false);
        expect(consumed.has('c,d')).toBe(false);
        subscription.push('c');
        subscription.push('d');
      } else {
        expect(consumed.has('a,b')).toBe(true);
        expect(consumed.has('c,d')).toBe(false);
        subscription.cancel();
      }
    }

    expect(received).toEqual(['a,b', 'c,d']);
    expect(consumed).toEqual(new Set(received));
    expect(cleanup).toBeCalledTimes(1);
    expect(cleanup.mock.calls[0][0]).toEqual([]);
  });

  test('coalesce break', async () => {
    const consumed = new Set<string>();
    const cleanup = vi.fn();

    const subscription = new Subscription<string>({
      cleanup,
      consumed: m => consumed.add(m),
      coalesce: (curr, prev) => `${prev},${curr}`,
    });
    subscription.push('a');
    subscription.push('b');

    const received: string[] = [];
    let i = 0;
    for await (const m of subscription) {
      received.push(m);

      if (i++ === 0) {
        expect(consumed.has('a,b')).toBe(false);
        expect(consumed.has('c,d')).toBe(false);
        subscription.push('c');
        subscription.push('d');
      } else {
        expect(consumed.has('a,b')).toBe(true);
        expect(consumed.has('c,d')).toBe(false);
        break;
      }
    }

    expect(received).toEqual(['a,b', 'c,d']);
    expect(consumed).toEqual(new Set(received));
    expect(cleanup).toBeCalledTimes(1);
    expect(cleanup.mock.calls[0][0]).toEqual([]);
  });
});