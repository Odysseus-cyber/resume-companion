import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { FormEngine } from '../src/engine/dom';
import { z } from 'zod';
const fillSchema = z.object({
  type: z.enum(['FILL', 'FILL_LAYOUT']),
  token: z.string(),
  items: z
    .array(
      z.object({
        id: z.string(),
        path: z.string(),
        value: z.string().max(20000),
        source: z.string(),
        confidence: z.number(),
        selected: z.boolean(),
        evidence: z.array(z.string()).max(30).optional(),
      }),
    )
    .max(500),
});
export default defineContentScript({
  // Explicit user-triggered executeScript only. Runtime matches would become required host permissions in WXT.
  matches: [],
  registration: 'runtime',
  main() {
    const state = globalThis as typeof globalThis & { __resumeCompanion?: boolean };
    if (state.__resumeCompanion) return;
    state.__resumeCompanion = true;
    const engine = new FormEngine();
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/')))
        return;
      const execute = async () => {
        if (message.type === 'SCAN') return engine.scan();
        if (message.type === 'SCAN_LAYOUT') return engine.scanLayout();
        if (message.type === 'CHECK_LAYOUT') {
          const m = z.object({ token: z.string() }).parse(message);
          return engine.validateLayout(m.token);
        }
        if (message.type === 'LOCATE') {
          const m = z.object({ token: z.string(), id: z.string() }).parse(message);
          return engine.locate(m.token, m.id);
        }
        if (message.type === 'FILL' || message.type === 'FILL_LAYOUT') {
          const m = fillSchema.parse(message);
          return message.type === 'FILL_LAYOUT'
            ? engine.fillLayout(m.token, m.items)
            : engine.fill(m.token, m.items);
        }
        if (message.type === 'UNDO') return engine.undo();
        throw new Error('未知操作');
      };
      execute().then(
        (data) => sendResponse({ ok: true, data }),
        (error) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : '操作失败' }),
      );
      return true;
    });
  },
});
