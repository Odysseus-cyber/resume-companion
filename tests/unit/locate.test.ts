import { describe, expect, it, vi } from 'vitest';
import { FormEngine } from '../../src/engine/dom';
import { matchField } from '../../src/engine/matcher';
import { demoProfile, facts } from '../../src/domain/model';

describe('locating anonymous controls without changing values', () => {
  it('scrolls and highlights the scanned node, without focusing or emitting input', () => {
    document.body.innerHTML = '<input><input>';
    const engine = new FormEngine();
    const scan = engine.scan('https://example.com/form');
    const nodes = document.querySelectorAll('input');
    const node = nodes[1]!;
    node.scrollIntoView = vi.fn();
    node.animate = vi.fn();
    const focus = vi.spyOn(node, 'focus');
    const input = vi.fn();
    node.addEventListener('input', input);
    engine.locate(scan.token, scan.fields[1]!.id);
    expect(node.scrollIntoView).toHaveBeenCalled();
    expect(node.animate).toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
    expect(node.value).toBe('');
  });
  it('rejects old scans, unknown IDs and detached nodes', () => {
    document.body.innerHTML = '<input>';
    const engine = new FormEngine();
    const old = engine.scan('https://example.com/form');
    const scan = engine.scan('https://example.com/form');
    expect(() => engine.locate(old.token, old.fields[0]!.id)).toThrow();
    expect(() => engine.locate(scan.token, 'invented')).toThrow();
    document.querySelector('input')!.remove();
    expect(() => engine.locate(scan.token, scan.fields[0]!.id)).toThrow();
  });
  it('does not reuse positional memories when a control lacks a stable label', () => {
    document.body.innerHTML = '<input>';
    const field = new FormEngine().scan('https://example.com/form').fields[0]!;
    expect(field.bindingStable).toBe(false);
    const result = matchField(field, {
      origin: 'https://example.com',
      facts: facts(demoProfile()),
      mappings: [
        {
          origin: 'https://example.com',
          signature: field.signature,
          label: field.label,
          path: 'personal.awards',
        },
      ],
    });
    expect(result.source).not.toBe('你的映射');
    expect(result.selected).toBe(false);
  });
});
