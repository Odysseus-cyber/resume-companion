import {
  assertCurrent,
  assertPopupOwned,
  closeWidgetPopup,
  equivalentChoice,
  openWidgetPopup,
  readWidgetValue,
  safeWidgetClick,
  waitForWidget,
  widgetEnabled,
  type WidgetContext,
  type WidgetResult,
} from './core';

function clearButtons(popup: HTMLElement): HTMLElement[] {
  return Array.from(popup.querySelectorAll<HTMLElement>('button,[role="button"]')).filter(
    (button) =>
      widgetEnabled(button) &&
      /^(?:清空选择|清除选择|clear selection)$/i.test(
        (button.getAttribute('aria-label') || button.textContent || '').trim(),
      ) &&
      (!(button instanceof HTMLButtonElement) || !button.form || button.type === 'button'),
  );
}

export async function fillListbox(
  trigger: HTMLElement,
  input: string,
  context: WidgetContext,
): Promise<WidgetResult> {
  assertCurrent(trigger, context);
  const before = readWidgetValue(trigger);
  const popup = await openWidgetPopup(trigger, context);
  try {
    const option = await waitForWidget(
      () => {
        assertPopupOwned(trigger, popup, context);
        if (readWidgetValue(trigger) !== before)
          throw new Error('字段内容已变化，已保留网页当前内容');
        if (popup.getAttribute('aria-busy') === 'true') return undefined;
        const options = Array.from(popup.querySelectorAll<HTMLElement>('[role="option"]')).filter(
          (element) =>
            widgetEnabled(element) &&
            equivalentChoice(
              element.getAttribute('aria-label') || element.textContent || '',
              input,
            ),
        );
        if (options.length > 1) throw new Error('存在多个同义选项，请手动核对');
        return options[0];
      },
      trigger,
      context,
      '未找到唯一匹配的下拉选项，请手动选择',
    );
    assertPopupOwned(trigger, popup, context);
    if (readWidgetValue(trigger) !== before) throw new Error('字段内容已变化，已保留网页当前内容');
    const hasClear = !before && clearButtons(popup).length === 1;
    safeWidgetClick(option, trigger, context);
    await waitForWidget(
      () => (equivalentChoice(readWidgetValue(trigger), input) ? true : undefined),
      trigger,
      context,
      '网页未保留下拉选项，请在网页中核对',
    );
    const after = readWidgetValue(trigger);
    return hasClear
      ? {
          undo: async () => {
            assertCurrent(trigger, context);
            if (readWidgetValue(trigger) !== after) throw new Error('保留用户后续修改');
            const undoPopup = await openWidgetPopup(trigger, context);
            try {
              assertPopupOwned(trigger, undoPopup, context);
              const buttons = clearButtons(undoPopup);
              if (buttons.length !== 1 || readWidgetValue(trigger) !== after)
                throw new Error('无法安全清空此选择，请手动恢复');
              safeWidgetClick(buttons[0]!, trigger, context);
              await waitForWidget(
                () => (readWidgetValue(trigger) === before ? true : undefined),
                trigger,
                context,
                '网页未恢复原选择，请手动核对',
              );
            } catch (error) {
              closeWidgetPopup(trigger, undoPopup, context);
              throw error;
            }
          },
        }
      : {};
  } catch (error) {
    closeWidgetPopup(trigger, popup, context);
    throw error;
  }
}
