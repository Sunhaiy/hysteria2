import { RecurringTask } from './sync-worker';

describe('Sync worker shutdown', () => {
  afterEach(() => jest.useRealTimers());

  it('waits for the active billing operation and schedules no new work after stop', async () => {
    jest.useFakeTimers();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    const task = new RecurringTask('isolated billing', 10, 1000, () => {
      runs++;
      return held;
    });
    task.start();
    await Promise.resolve();
    let drained = false;
    const stopped = Promise.resolve(task.stop()).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    await jest.advanceTimersByTimeAsync(1100);
    expect(drained).toBe(false);
    expect(runs).toBe(1);
    release();
    await stopped;
    expect(drained).toBe(true);
    await jest.advanceTimersByTimeAsync(100);
    expect(runs).toBe(1);
  });
});
