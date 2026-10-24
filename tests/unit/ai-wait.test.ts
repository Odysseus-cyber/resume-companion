// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../../src/ai/client';
import { settingsSchema, defaultDatabase, migrate } from '../../src/domain/model';
import { encryptBackup, restoreBackup } from '../../src/domain/backup';

const args = ['https://api.example.com/v1', 'model', 'fictional-key', {}, 'Return JSON'] as const;
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AI wait settings and cancellation', () => {
  it.each([
    [undefined, 30000],
    [120, 120000],
    [300, 300000],
  ])('uses configured seconds %s without changing payload', async (timeoutSeconds, expected) => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    expect(await request(...args, { timeoutSeconds })).toEqual([]);
    expect(timeout).toHaveBeenCalledWith(expected);
    expect(fetch.mock.calls[0]![1].body).not.toContain('timeoutSeconds');
  });
  it('does not create a deadline for unlimited waiting and still supports cancellation', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
          }),
      ),
    );
    const pending = request(...args, { timeoutSeconds: null, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow('已取消');
    controller.abort(new Error('已取消 AI 请求'));
    await rejected;
    expect(timeout).not.toHaveBeenCalled();
  });
  it('rejects a late response after cancellation even if transport ignores abort', async () => {
    const controller = new AbortController();
    let deliver!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            deliver = resolve;
          }),
      ),
    );
    const pending = request(...args, { timeoutSeconds: null, signal: controller.signal });
    controller.abort(new Error('已取消 AI 请求'));
    deliver(response());
    await expect(pending).rejects.toThrow('已取消');
  });
  it('never sends an already cancelled request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      request(...args, { timeoutSeconds: null, signal: AbortSignal.abort(new Error('已取消')) }),
    ).rejects.toThrow('已取消');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 86401, Infinity, NaN])(
    'rejects invalid wait limit %s before network access',
    async (timeoutSeconds) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(request(...args, { timeoutSeconds })).rejects.toThrow('等待时长');
      expect(
        settingsSchema.safeParse({ aiEnabled: true, endpoint: '', model: '', timeoutSeconds })
          .success,
      ).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('keeps older settings compatible and round-trips unlimited waiting through backups', async () => {
    const db = defaultDatabase();
    expect(migrate(db).settings.timeoutSeconds).toBeUndefined();
    db.settings.timeoutSeconds = null;
    expect(
      (await restoreBackup(await encryptBackup(db, 'fictional-password'), 'fictional-password'))
        .settings.timeoutSeconds,
    ).toBeNull();
  });
});
