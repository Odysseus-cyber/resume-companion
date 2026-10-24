import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillListbox } from '../../src/engine/widgets/select';
import {
  equivalentChoice,
  openWidgetPopup,
  readWidgetValue,
  type WidgetContext,
} from '../../src/engine/widgets/core';

const context: WidgetContext = { isCurrent: () => true, path: 'personal.highestEducation' };
function fixture(options = '<div role="option">大学本科</div>') {
  document.body.innerHTML = `<input readonly role="combobox" aria-controls="popup" aria-expanded="false"><div id="popup" role="listbox" hidden>${options}</div><div role="option">本科</div>`;
  const trigger = document.querySelector('input')!;
  const popup = document.getElementById('popup')!;
  trigger.addEventListener('click', () => {
    trigger.setAttribute('aria-expanded', 'true');
    popup.hidden = false;
  });
  popup.addEventListener('click', (event) => {
    const option = (event.target as Element).closest('[role="option"]');
    if (!option) return;
    trigger.value = option.textContent || '';
    popup.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  });
  return { trigger, popup };
}
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => vi.useRealTimers());

describe('accessible listbox driver', () => {
  it('fills readonly triggers using local semantic aliases and ignores unrelated options', async () => {
    const { trigger } = fixture();
    const unrelatedClick = vi.fn();
    document.body.lastElementChild!.addEventListener('click', unrelatedClick);
    const result = await fillListbox(trigger, '本科', context);
    expect(trigger.value).toBe('大学本科');
    expect(unrelatedClick).not.toHaveBeenCalled();
    expect(result.undo).toBeUndefined();
  });

  it('waits for delayed options and controlled value updates', async () => {
    const { trigger, popup } = fixture('');
    trigger.addEventListener('click', () => {
      setTimeout(() => {
        popup.innerHTML = '<div role="option">大学本科</div>';
      }, 75);
    });
    await fillListbox(trigger, '本科', context);
    expect(trigger.value).toBe('大学本科');
  });

  it('waits while a listbox reports busy', async () => {
    const { trigger, popup } = fixture();
    popup.setAttribute('aria-busy', 'true');
    setTimeout(() => popup.removeAttribute('aria-busy'), 60);
    await fillListbox(trigger, '本科', context);
    expect(trigger.value).toBe('大学本科');
  });

  it('rejects ambiguous synonyms without selecting either', async () => {
    const { trigger } = fixture('<div role="option">本科</div><div role="option">大学本科</div>');
    await expect(fillListbox(trigger, '本科', context)).rejects.toThrow('多个同义选项');
    expect(trigger.value).toBe('');
  });

  it('ignores disabled options', async () => {
    const { trigger } = fixture(
      '<div role="option" aria-disabled="true">本科</div><div role="option">大学本科</div>',
    );
    await fillListbox(trigger, '本科', context);
    expect(trigger.value).toBe('大学本科');
  });

  it.each(['disabled', 'aria-readonly="true"', 'aria-disabled="true"'])(
    'does not open a blocked trigger: %s',
    async (attribute) => {
      document.body.innerHTML = `<input role="combobox" aria-controls="popup" ${attribute}><div id="popup"></div>`;
      const trigger = document.querySelector('input')!;
      const clicked = vi.fn();
      trigger.addEventListener('click', clicked);
      await expect(fillListbox(trigger, '本科', context)).rejects.toThrow('已变化');
      expect(clicked).not.toHaveBeenCalled();
    },
  );

  it('stops when popup ownership changes during an asynchronous load', async () => {
    const { trigger } = fixture('');
    trigger.addEventListener('click', () => trigger.setAttribute('aria-controls', 'other'));
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="other"><div role="option">本科</div></div>',
    );
    const selected = vi.fn();
    document.querySelector('#other [role="option"]')!.addEventListener('click', selected);
    // Ownership changes before opening returns, so parent semantic guard must
    // reject it; changing ownership after opening is checked by the driver.
    const original = trigger.getAttribute('aria-controls');
    await expect(
      fillListbox(trigger, '本科', {
        ...context,
        isCurrent: () => trigger.getAttribute('aria-controls') === original,
      }),
    ).rejects.toThrow('已变化');
    expect(selected).not.toHaveBeenCalled();
  });

  it('preserves a value populated while the popup opens', async () => {
    const { trigger } = fixture();
    trigger.addEventListener('click', () => {
      trigger.value = '硕士';
    });
    await expect(fillListbox(trigger, '本科', context)).rejects.toThrow('内容已变化');
    expect(trigger.value).toBe('硕士');
  });

  it('rejects a wrapper containing a genuinely disabled native input', async () => {
    document.body.innerHTML =
      '<div role="combobox" aria-controls="popup"><input disabled></div><div id="popup" hidden></div>';
    await expect(fillListbox(document.querySelector('div')!, '本科', context)).rejects.toThrow(
      '已变化',
    );
  });

  it('stops after user interference without selecting or dismissing their popup', async () => {
    const { trigger, popup } = fixture('');
    let current = true;
    const escape = vi.fn();
    const optionClick = vi.fn();
    trigger.addEventListener('keydown', escape);
    setTimeout(() => {
      current = false;
      popup.innerHTML = '<div role="option">本科</div>';
      popup.firstElementChild!.addEventListener('click', optionClick);
    }, 40);
    await expect(
      fillListbox(trigger, '本科', { ...context, isCurrent: () => current }),
    ).rejects.toThrow('已变化');
    expect(escape).not.toHaveBeenCalled();
    expect(optionClick).not.toHaveBeenCalled();
  });

  it('rejects popup replacement even if its identifier stays the same', async () => {
    const { trigger, popup } = fixture('');
    setTimeout(() => {
      popup.outerHTML = '<div id="popup"><div role="option">本科</div></div>';
    }, 40);
    await expect(fillListbox(trigger, '本科', context)).rejects.toThrow('范围已变化');
    expect(trigger.value).toBe('');
  });

  it('never opens submit buttons associated with a form', async () => {
    document.body.innerHTML =
      '<form><button role="combobox" aria-controls="popup"></button><div id="popup" hidden></div></form>';
    const trigger = document.querySelector('button')!;
    const click = vi.fn();
    trigger.addEventListener('click', click);
    await expect(openWidgetPopup(trigger, context)).rejects.toThrow('提交');
    expect(click).not.toHaveBeenCalled();
  });

  it('rejects duplicate popup identifiers', async () => {
    const { trigger } = fixture();
    document.body.insertAdjacentHTML('beforeend', '<div id="popup"></div>');
    await expect(fillListbox(trigger, '本科', context)).rejects.toThrow('编号不唯一');
  });

  it('times out without selecting unrecognized options', async () => {
    vi.useFakeTimers();
    const { trigger } = fixture('<div role="option">硕士</div>');
    const pending = expect(fillListbox(trigger, '本科', context)).rejects.toThrow('未找到唯一匹配');
    await vi.runAllTimersAsync();
    await pending;
    expect(trigger.value).toBe('');
  });

  it('fails readback when a widget ignores the chosen option', async () => {
    vi.useFakeTimers();
    const { trigger, popup } = fixture();
    popup
      .querySelector('[role="option"]')!
      .addEventListener('click', (event) => event.stopPropagation());
    const pending = expect(fillListbox(trigger, '本科', context)).rejects.toThrow('未保留');
    await vi.runAllTimersAsync();
    await pending;
    expect(trigger.value).toBe('');
  });

  it('undoes with an explicit scoped clear action and verifies empty state', async () => {
    const { trigger, popup } = fixture(
      '<div role="option">大学本科</div><button type="button" aria-label="清空选择">清空选择</button>',
    );
    popup.querySelector('button')!.addEventListener('click', () => {
      trigger.value = '';
      popup.hidden = true;
    });
    const result = await fillListbox(trigger, '本科', context);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(trigger.value).toBe('');
  });

  it('undo preserves subsequent edits', async () => {
    const { trigger, popup } = fixture(
      '<div role="option">大学本科</div><button type="button">清空选择</button>',
    );
    const clear = vi.fn();
    popup.querySelector('button')!.addEventListener('click', clear);
    const result = await fillListbox(trigger, '本科', context);
    trigger.value = '硕士';
    await expect(result.undo!()).rejects.toThrow('后续修改');
    expect(clear).not.toHaveBeenCalled();
  });

  it('reads wrapped native inputs without mixing labels into the value', () => {
    document.body.innerHTML = '<div role="combobox">学历<input readonly value="大学本科"></div>';
    expect(readWidgetValue(document.querySelector('div')!)).toBe('大学本科');
  });

  it('ignores an inline popup search input inserted ahead of the actual value input', async () => {
    document.body.innerHTML =
      '<div role="combobox" aria-controls="inline" aria-expanded="false"><div id="inline" role="listbox" hidden></div><input readonly></div>';
    const trigger = document.querySelector<HTMLElement>('[role="combobox"]')!;
    const popup = document.getElementById('inline')!;
    const valueInput = trigger.querySelector('input')!;
    trigger.addEventListener('click', (event) => {
      if (event.target !== trigger) return;
      popup.innerHTML =
        '<input type="search" value="私密搜索内容"><div role="option">大学本科</div>';
      popup.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      popup.querySelector('[role="option"]')!.addEventListener('click', () => {
        valueInput.value = '大学本科';
        popup.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      });
    });
    expect(readWidgetValue(trigger)).toBe('');
    await fillListbox(trigger, '本科', context);
    expect(readWidgetValue(trigger)).toBe('大学本科');
    expect(popup.querySelector('input')!.value).toBe('私密搜索内容');
  });

  it('reads only the display text of a wrapper with inline options and search', async () => {
    document.body.innerHTML =
      '<div role="combobox" aria-controls="inline"><span>请选择</span><div id="inline" role="listbox"><input type="search" value="不可作为字段值"><div role="option">大学本科</div><div role="option">硕士研究生</div></div></div>';
    const trigger = document.querySelector<HTMLElement>('[role="combobox"]')!;
    expect(readWidgetValue(trigger)).toBe('');
    document.querySelector('[role="option"]')!.addEventListener('click', () => {
      trigger.querySelector('span')!.textContent = '大学本科';
      document.getElementById('inline')!.hidden = true;
    });
    await fillListbox(trigger, '本科', context);
    expect(readWidgetValue(trigger)).toBe('大学本科');
  });

  it('does not equate distinct locations, degree levels, or study modes', () => {
    expect(equivalentChoice('北京市', '北京')).toBe(false);
    expect(equivalentChoice('本科', '硕士')).toBe(false);
    expect(equivalentChoice('全日制', '非全日制')).toBe(false);
  });
});
