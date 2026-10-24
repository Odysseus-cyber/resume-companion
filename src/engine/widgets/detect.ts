/** Choice triggers are identified by explicit DOM semantics, never by a page-wide click guess. */
export const choiceTriggerSelector =
  '[role="combobox"],input[aria-haspopup="listbox"],input[aria-haspopup="dialog"],input[aria-haspopup="tree"],button[aria-haspopup="listbox"],button[aria-haspopup="dialog"],button[aria-haspopup="tree"]';

export function isChoiceTrigger(node: HTMLElement): boolean {
  return node.matches(choiceTriggerSelector);
}

export function insideChoicePopup(node: Node, trigger: HTMLElement): boolean {
  const ids = new Set(
    `${trigger.getAttribute('aria-controls') || ''} ${trigger.getAttribute('aria-owns') || ''}`
      .split(/\s+/)
      .filter(Boolean),
  );
  for (
    let parent = node instanceof Element ? node : node.parentElement;
    parent && parent !== trigger;
    parent = parent.parentElement
  ) {
    if (ids.has(parent.id)) return true;
  }
  return false;
}

export function widgetMembers(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>('input,textarea,select')).filter(
    (child) => !insideChoicePopup(child, node),
  );
}

export function choiceSupportReason(node: HTMLElement): string | undefined {
  if (
    node.matches(':disabled') ||
    node.getAttribute('aria-disabled') === 'true' ||
    widgetMembers(node).some((child) => child.matches(':disabled'))
  )
    return '控件已禁用';
  if (node.getAttribute('aria-readonly') === 'true') return '只读控件需手动操作';
  if (!node.getAttribute('aria-controls')?.trim() && !node.getAttribute('aria-owns')?.trim())
    return '无法确认自定义下拉菜单范围';
  if (node instanceof HTMLButtonElement && node.form && node.type === 'submit')
    return '提交按钮不能作为自动选择入口';
  if (widgetMembers(node).length > 1) return '选择器包含多个输入，需手动操作';
  return undefined;
}

/** Popup content is local UI state: exclude options, searches and selection summaries from AI. */
export function choicePopups(): Set<HTMLElement> {
  const popups = new Set<HTMLElement>();
  for (const trigger of document.querySelectorAll<HTMLElement>(choiceTriggerSelector)) {
    for (const id of `${trigger.getAttribute('aria-controls') || ''} ${trigger.getAttribute('aria-owns') || ''}`
      .split(/\s+/)
      .filter(Boolean)) {
      for (const popup of document.querySelectorAll<HTMLElement>('[id]')) {
        if (
          popup.id === id &&
          popup !== document.body &&
          popup !== document.documentElement &&
          !popup.contains(trigger)
        )
          popups.add(popup);
      }
    }
  }
  return popups;
}

/** Keep an accessible wrapper and its native value input as a single logical control. */
export function deduplicateChoices<T extends HTMLElement>(nodes: T[]): T[] {
  return nodes.filter(
    (node) =>
      !nodes.some((other) => other !== node && isChoiceTrigger(other) && other.contains(node)),
  );
}
