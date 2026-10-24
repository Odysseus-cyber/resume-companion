import { visible } from '../labels';
import {
  assertCurrent,
  assertPopupOwned,
  closeWidgetPopup,
  openWidgetPopup,
  readWidgetValue,
  safeWidgetClick,
  waitForWidget,
  widgetEnabled,
  type WidgetContext,
  type WidgetResult,
} from './core';

// Keep administrative suffixes: 吉林省 and 吉林市 are different places.
const compact = (value: string) => value.normalize('NFKC').replace(/[\s/／>＞→,，、·]+/g, '');
const itemSelector = '[role="treeitem"],[role="group"][aria-label]';
function name(element: HTMLElement): string {
  const explicit = element.getAttribute('aria-label');
  if (explicit) return explicit.trim();
  const labelled = element.getAttribute('aria-labelledby');
  if (labelled)
    return labelled
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' ')
      .trim();
  if (element instanceof HTMLInputElement)
    return Array.from(element.labels || [], (label) => label.textContent || '')
      .join(' ')
      .trim();
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || '')
    .join(' ')
    .trim();
}
function button(popup: HTMLElement, names: string[]): HTMLElement | undefined {
  const matches = Array.from(popup.querySelectorAll<HTMLElement>('button,[role="button"]')).filter(
    (node) => visible(node) && names.includes(name(node) || node.textContent?.trim() || ''),
  );
  if (matches.length > 1) throw new Error('地区选择器操作按钮不唯一，请手动选择');
  const match = matches[0];
  if (match instanceof HTMLButtonElement && match.type !== 'button')
    throw new Error('地区选择器按钮可能提交表单，已停止');
  return match;
}
function ownNodes(item: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(item.querySelectorAll<HTMLElement>(selector)).filter(
    (node) => node.closest(itemSelector) === item && visible(node),
  );
}
function cancel(trigger: HTMLElement, popup: HTMLElement, context: WidgetContext): void {
  try {
    assertPopupOwned(trigger, popup, context);
    const action = button(popup, ['取消', 'Cancel']);
    if (action) safeWidgetClick(action, trigger, context);
    else closeWidgetPopup(trigger, popup, context);
  } catch {
    // A stale or replaced dialog belongs to the user, not this operation.
  }
}

/** Operate only an explicitly bound, accessible region dialog. Values stay local. */
export async function fillRegion(
  trigger: HTMLElement,
  input: string,
  context: WidgetContext,
): Promise<WidgetResult> {
  assertCurrent(trigger, context);
  if (readWidgetValue(trigger)) throw new Error('保留已有地区内容');
  const desired = compact(input);
  if (!desired || desired.length > 120) throw new Error('地区资料格式不明确，请手动选择');
  const popup = await openWidgetPopup(trigger, context);
  const guard = () => {
    assertPopupOwned(trigger, popup, context);
    if (readWidgetValue(trigger)) throw new Error('地区字段内容已变化，已停止操作');
  };
  guard();
  // An already staged choice belongs to the user: do not even cancel it.
  if (popup.querySelector('input:checked,[aria-checked="true"],[aria-selected="true"]'))
    throw new Error('地区窗口已有选择，请先手动处理');
  const searchInputs = () =>
    Array.from(
      popup.querySelectorAll<HTMLInputElement>('input[role="searchbox"],input[type="search"]'),
    ).filter(visible);
  if (searchInputs().some((search) => search.value.trim()))
    throw new Error('地区窗口已有搜索内容，保留用户输入');
  try {
    guard();
    if (!['dialog', 'tree'].includes(popup.getAttribute('role') || ''))
      throw new Error('地区控件结构暂不支持自动填写');

    let selected = false;
    // Search is used only when the widget already exposes complete path results.
    const searches = searchInputs().filter((search) => widgetEnabled(search) && !search.readOnly);
    const fullOptions = () =>
      Array.from(popup.querySelectorAll<HTMLElement>('[role="option"]')).filter(widgetEnabled);
    if (searches.length === 1 && fullOptions().some((option) => /[/／>＞→]/.test(name(option)))) {
      guard();
      const search = searches[0]!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        input,
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
      const option = await waitForWidget(
        () => {
          guard();
          const matches = fullOptions().filter((node) => compact(name(node)) === desired);
          if (matches.length > 1) throw new Error('地区搜索结果不唯一，请手动选择');
          return matches[0];
        },
        trigger,
        context,
        '未找到完整地区路径，请手动选择',
      );
      guard();
      if (!popup.contains(option) || compact(name(option)) !== desired)
        throw new Error('地区搜索结果已变化，请重新识别');
      safeWidgetClick(option, trigger, context);
      selected = true;
    }

    let consumed = '';
    let scope = popup;
    const branches: { node: HTMLElement; parent: HTMLElement | null; label: string }[] = [];
    const guardBranches = () => {
      guard();
      for (const branch of branches) {
        if (
          !popup.contains(branch.node) ||
          !widgetEnabled(branch.node) ||
          branch.node.parentElement !== branch.parent ||
          name(branch.node) !== branch.label
        )
          throw new Error('地区层级已变化，请重新识别');
      }
    };
    for (let depth = 0; !selected && depth < 5; depth++) {
      const found = await waitForWidget(
        () => {
          guardBranches();
          const candidates = Array.from(scope.querySelectorAll<HTMLElement>(itemSelector)).filter(
            (node) => {
              if (!widgetEnabled(node)) return false;
              const parent = node.parentElement?.closest(itemSelector);
              return !parent || parent === scope || !scope.contains(parent);
            },
          );
          const matches = candidates.filter((node) => {
            const segment = compact(name(node));
            if (!segment || !desired.startsWith(consumed + segment)) return false;
            if (consumed + segment !== desired) return true;
            const radios = ownNodes(node, 'input[type="radio"],[role="radio"]');
            return radios.length ? radios.some(widgetEnabled) : node.hasAttribute('aria-selected');
          });
          if (matches.length > 1) throw new Error('地区层级对应不唯一，请手动选择');
          const node = matches[0];
          return node ? { node, parent: node.parentElement, label: name(node) } : undefined;
        },
        trigger,
        context,
        '未找到对应地区层级，请手动选择',
      );
      guardBranches();
      const item = found.node;
      if (!scope.contains(item)) throw new Error('地区层级已变化，请重新识别');
      branches.push(found);
      guardBranches();
      const segment = compact(name(item));
      consumed += segment;
      if (consumed === desired) {
        const radios = ownNodes(item, 'input[type="radio"],[role="radio"]').filter(widgetEnabled);
        if (radios.length > 1) throw new Error('地区选项不唯一，请手动选择');
        const target = radios[0] || (item.hasAttribute('aria-selected') ? item : undefined);
        if (!target) throw new Error('地区选项没有明确选择操作，请手动选择');
        guardBranches();
        if (target !== item && target.closest(itemSelector) !== item)
          throw new Error('地区选项归属已变化，请重新识别');
        safeWidgetClick(target, trigger, context);
        await waitForWidget(
          () => {
            guardBranches();
            if (target !== item && target.closest(itemSelector) !== item)
              throw new Error('地区选项归属已变化，请重新识别');
            return target.isConnected &&
              (target instanceof HTMLInputElement
                ? target.checked
                : target.getAttribute('aria-checked') === 'true' ||
                  target.getAttribute('aria-selected') === 'true')
              ? true
              : undefined;
          },
          trigger,
          context,
          '地区选项未能选中，请手动选择',
        );
        selected = true;
      } else {
        // Expanding a branch must not select its radio or a broader region.
        if (!item.hasAttribute('aria-expanded'))
          throw new Error('地区选项没有明确展开操作，请手动选择');
        if (item.getAttribute('aria-expanded') !== 'true') {
          const expanders = ownNodes(item, 'button,[role="button"]').filter((node) =>
            /^(?:展开|展开地区|展开子级|expand)$/i.test(
              name(node) || node.textContent?.trim() || '',
            ),
          );
          if (expanders.length !== 1) throw new Error('地区分支展开按钮不唯一，请手动选择');
          safeWidgetClick(expanders[0]!, trigger, context);
        }
        // Nested ARIA trees provide unambiguous ancestry. Column-only pickers
        // require a site adapter with an explicit parent/child relationship.
        scope = item;
      }
    }
    if (!selected) throw new Error('地区层级超过自动处理范围，请手动选择');
    guardBranches();
    const confirm = button(popup, ['确定', '确认']);
    if (!confirm) throw new Error('未找到地区窗口内的确认按钮，请手动选择');
    const canClear = !!button(popup, ['清空', '清空已选']);
    safeWidgetClick(confirm, trigger, context);
    await waitForWidget(
      () => (compact(readWidgetValue(trigger)) === desired ? true : undefined),
      trigger,
      context,
      '地区选择后回读不一致，请在网页核对',
    );
    assertCurrent(trigger, context);
    if (!canClear) return {};
    return {
      undo: async () => {
        assertCurrent(trigger, context);
        if (compact(readWidgetValue(trigger)) !== desired)
          throw new Error('地区已被修改，保留当前内容');
        const opened = await openWidgetPopup(trigger, context);
        try {
          assertPopupOwned(trigger, opened, context);
          if (compact(readWidgetValue(trigger)) !== desired)
            throw new Error('地区已被修改，保留当前内容');
          const clear = button(opened, ['清空', '清空已选']);
          if (!clear) throw new Error('地区控件无法安全清空，请手动恢复');
          safeWidgetClick(clear, trigger, context);
          assertCurrent(trigger, context);
          if (readWidgetValue(trigger) && visible(opened)) {
            assertPopupOwned(trigger, opened, context);
            const commit = button(opened, ['确定', '确认']);
            if (!commit) throw new Error('地区控件无法确认清空，请手动恢复');
            safeWidgetClick(commit, trigger, context);
          }
          await waitForWidget(
            () => (!readWidgetValue(trigger) ? true : undefined),
            trigger,
            context,
            '地区清空后回读失败，请手动恢复',
          );
        } catch (error) {
          cancel(trigger, opened, context);
          throw error;
        }
      },
    };
  } catch (error) {
    cancel(trigger, popup, context);
    throw error;
  }
}
