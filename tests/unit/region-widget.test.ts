import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillRegion } from '../../src/engine/widgets/region';

beforeEach(() => {
  document.body.innerHTML = '';
});

function fixture(delay = 0) {
  document.body.innerHTML = `<form><input id="region" readonly role="combobox" aria-controls="picker" aria-expanded="false"><button type="submit">提交申请</button></form>
    <div id="picker" role="dialog" hidden>
      <div role="tree"><div role="treeitem" aria-label="浙江省" aria-expanded="false">
        <button type="button" aria-label="展开">展开</button>
        <div role="group" hidden>
          <div role="treeitem" aria-label="杭州市" aria-expanded="false">
            <label><input type="radio" name="region" value="浙江省/杭州市">杭州市</label><button type="button" aria-label="展开">展开</button>
            <div role="group" hidden><div role="treeitem" aria-label="余杭区"><label><input type="radio" name="region" value="浙江省/杭州市/余杭区">余杭区</label></div></div>
          </div>
          <div role="treeitem" aria-label="第二市" aria-expanded="false"><button type="button" aria-label="展开">展开</button><div role="group" hidden><div role="treeitem" aria-label="余杭区"><label><input type="radio" name="region" value="浙江省/第二市/余杭区">余杭区</label></div></div></div>
        </div>
      </div></div>
      <button type="button" id="confirm">确定</button><button type="button" id="cancel">取消</button><button type="button" id="clear">清空</button>
    </div>`;
  const trigger = document.querySelector<HTMLInputElement>('#region')!;
  const popup = document.querySelector<HTMLElement>('#picker')!;
  const submitted = vi.fn((event: Event) => event.preventDefault());
  document.querySelector('form')!.addEventListener('submit', submitted);
  trigger.onclick = () => {
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    popup.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  for (const expand of popup.querySelectorAll<HTMLButtonElement>('[aria-label="展开"]')) {
    expand.onclick = () => {
      const reveal = () => {
        expand.parentElement!.setAttribute('aria-expanded', 'true');
        expand.parentElement!.querySelector<HTMLElement>(':scope > [role="group"]')!.hidden = false;
      };
      if (delay) setTimeout(reveal, delay);
      else reveal();
    };
  }
  document.querySelector<HTMLButtonElement>('#confirm')!.onclick = () => {
    trigger.value = popup.querySelector<HTMLInputElement>('input:checked')?.value || '';
    close();
  };
  const cancelled = vi.fn(() => {
    popup
      .querySelectorAll<HTMLInputElement>('input:checked')
      .forEach((radio) => (radio.checked = false));
    close();
  });
  document.querySelector<HTMLButtonElement>('#cancel')!.onclick = cancelled;
  document.querySelector<HTMLButtonElement>('#clear')!.onclick = () => {
    trigger.value = '';
    popup.querySelectorAll<HTMLInputElement>('input').forEach((radio) => (radio.checked = false));
    close();
  };
  return {
    trigger,
    popup,
    submitted,
    cancelled,
    context: { isCurrent: () => true, path: 'personal.householdLocation' },
  };
}

describe('bounded local region selection', () => {
  it('waits for asynchronous nested branches, checks full path, and restores blank on undo', async () => {
    const { trigger, context, popup, submitted } = fixture(35);
    const result = await fillRegion(trigger, '浙江省杭州市余杭区', context);
    expect(trigger.value).toBe('浙江省/杭州市/余杭区');
    expect(popup.hidden).toBe(true);
    expect(submitted).not.toHaveBeenCalled();
    await result.undo!();
    expect(trigger.value).toBe('');
  });
  it('selects city level without inventing a district', async () => {
    const { trigger, context, popup } = fixture();
    await fillRegion(trigger, '浙江省 / 杭州市', context);
    expect(trigger.value).toBe('浙江省/杭州市');
    expect(popup.querySelector('[aria-label="杭州市"]')!.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
  it('rejects duplicate sibling names without selecting either', async () => {
    const { trigger, context, popup, cancelled } = fixture();
    const city = popup.querySelector('[aria-label="杭州市"]')!;
    city.parentElement!.append(city.cloneNode(true));
    await expect(fillRegion(trigger, '浙江省杭州市', context)).rejects.toThrow('不唯一');
    expect(trigger.value).toBe('');
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('does not overwrite a populated trigger or user-staged selection', async () => {
    const { trigger, context, popup, cancelled } = fixture();
    trigger.value = '原地区';
    await expect(fillRegion(trigger, '浙江省杭州市', context)).rejects.toThrow('保留');
    expect(popup.hidden).toBe(true);
    trigger.value = '';
    popup.hidden = false;
    const radio = popup.querySelector<HTMLInputElement>('input')!;
    radio.checked = true;
    await expect(fillRegion(trigger, '浙江省杭州市', context)).rejects.toThrow('已有选择');
    expect(radio.checked).toBe(true);
    expect(cancelled).not.toHaveBeenCalled();
  });
  it('stops before a delayed branch action when the target becomes stale', async () => {
    const { trigger, context, cancelled } = fixture(50);
    let current = true;
    context.isCurrent = () => current;
    const result = fillRegion(trigger, '浙江省杭州市', context);
    setTimeout(() => (current = false), 5);
    await expect(result).rejects.toThrow('已变化');
    expect(trigger.value).toBe('');
    expect(cancelled).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  it('rejects submit-type confirmation even outside a form', async () => {
    const { trigger, context, submitted, cancelled } = fixture();
    document.querySelector<HTMLButtonElement>('#confirm')!.type = 'submit';
    await expect(fillRegion(trigger, '浙江省杭州市', context)).rejects.toThrow('提交');
    expect(trigger.value).toBe('');
    expect(submitted).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('does not undo a later manual edit', async () => {
    const { trigger, context } = fixture();
    const result = await fillRegion(trigger, '浙江省杭州市', context);
    trigger.value = '用户后来选择';
    await expect(result.undo!()).rejects.toThrow('保留当前内容');
    expect(trigger.value).toBe('用户后来选择');
  });
  it('marks manual undo when no explicit clear action exists', async () => {
    const { trigger, context } = fixture();
    document.querySelector('#clear')!.remove();
    const result = await fillRegion(trigger, '浙江省杭州市', context);
    expect(result.undo).toBeUndefined();
  });
  it('uses search only for explicitly exposed complete paths', async () => {
    const { trigger, context, popup } = fixture();
    popup.querySelector('[role="tree"]')!.remove();
    popup.insertAdjacentHTML(
      'afterbegin',
      '<input role="searchbox"><div role="option" aria-label="浙江省/杭州市/余杭区"></div><div role="option" aria-disabled="true" aria-label="浙江省/杭州市/余杭区"></div>',
    );
    const search = popup.querySelector<HTMLInputElement>('[role="searchbox"]')!;
    const option = popup.querySelector<HTMLElement>('[role="option"]')!;
    option.onclick = () => option.setAttribute('aria-selected', 'true');
    document.querySelector<HTMLButtonElement>('#confirm')!.onclick = () => {
      trigger.value = option.getAttribute('aria-selected') === 'true' ? '浙江省/杭州市/余杭区' : '';
      popup.hidden = true;
    };
    await fillRegion(trigger, '浙江省杭州市余杭区', context);
    expect(search.value).toBe('浙江省杭州市余杭区');
    expect(trigger.value).toBe('浙江省/杭州市/余杭区');
  });
  it('preserves an existing search query without selecting or cancelling', async () => {
    const { trigger, context, popup, cancelled } = fixture();
    popup.insertAdjacentHTML(
      'afterbegin',
      '<input role="searchbox" value="用户正在搜索"><div role="option" aria-label="浙江省/杭州市/余杭区"></div>',
    );
    await expect(fillRegion(trigger, '浙江省杭州市余杭区', context)).rejects.toThrow(
      '已有搜索内容',
    );
    expect(popup.querySelector<HTMLInputElement>('[role="searchbox"]')!.value).toBe('用户正在搜索');
    expect(trigger.value).toBe('');
    expect(cancelled).not.toHaveBeenCalled();
    expect(popup.querySelector('[aria-label="浙江省"]')!.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
  it('ignores a disabled duplicate when the remaining sibling has a unique selectable path', async () => {
    const { trigger, context, popup } = fixture();
    const city = popup.querySelector('[aria-label="杭州市"]')!;
    const duplicate = city.cloneNode(true) as HTMLElement;
    duplicate
      .querySelectorAll<HTMLInputElement>('input')
      .forEach((radio) => (radio.disabled = true));
    city.parentElement!.append(duplicate);
    await fillRegion(trigger, '浙江省杭州市', context);
    expect(trigger.value).toBe('浙江省/杭州市');
    expect(duplicate.querySelector<HTMLInputElement>('input')!.checked).toBe(false);
  });
  it('does not confirm a radio moved to another tree item after selection', async () => {
    const { trigger, context, popup, cancelled } = fixture();
    const city = popup.querySelector('[aria-label="杭州市"]')!;
    const radio = city.querySelector<HTMLInputElement>('input')!;
    radio.onclick = () => popup.querySelector('[aria-label="第二市"]')!.append(radio);
    await expect(fillRegion(trigger, '浙江省杭州市', context)).rejects.toThrow('归属已变化');
    expect(trigger.value).toBe('');
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('does not guess the province or city from a bare district name', async () => {
    const { trigger, context, popup, cancelled } = fixture();
    await expect(fillRegion(trigger, '余杭区', context)).rejects.toThrow('未找到对应地区层级');
    expect(trigger.value).toBe('');
    expect(popup.querySelector('[aria-label="浙江省"]')!.getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('stops if a branch action replaces the bound popup', async () => {
    const { trigger, context, popup, cancelled } = fixture();
    popup.querySelector<HTMLButtonElement>('[aria-label="展开"]')!.onclick = () => {
      popup.replaceWith(popup.cloneNode(true));
    };
    await expect(fillRegion(trigger, '浙江省杭州市', context)).rejects.toThrow('范围已变化');
    expect(trigger.value).toBe('');
    expect(cancelled).not.toHaveBeenCalled();
  });
});
