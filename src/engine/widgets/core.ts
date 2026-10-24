import { visible } from '../labels';
import { insideChoicePopup, widgetMembers } from './detect';

export interface WidgetContext {
  isCurrent: () => boolean;
  path: string;
}
export interface WidgetResult {
  undo?: () => Promise<void>;
}

export function widgetEnabled(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    visible(element) &&
    !element.matches(':disabled') &&
    !element.closest('[aria-disabled="true"],[aria-readonly="true"],[inert]')
  );
}

export function assertCurrent(trigger: HTMLElement, context: WidgetContext): void {
  const native = nativeValueMember(trigger);
  if (
    !context.isCurrent() ||
    !widgetEnabled(trigger) ||
    (native && (!widgetEnabled(native) || native.getAttribute('aria-readonly') === 'true'))
  )
    throw new Error('字段或页面已变化，已停止操作此控件');
}

function nativeValueMember(trigger: HTMLElement) {
  return widgetMembers(trigger).find(
    (member): member is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      (member instanceof HTMLInputElement && member.type !== 'hidden') ||
      member instanceof HTMLTextAreaElement ||
      member instanceof HTMLSelectElement,
  );
}

const normalizeChoice = (value: string) =>
  value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export function equivalentChoice(a: string, b: string): boolean {
  const aliases: Record<string, string> = {
    学士: '本科',
    大学本科: '本科',
    bachelor: '本科',
    硕士研究生: '硕士',
    master: '硕士',
    博士研究生: '博士',
    phd: '博士',
    male: '男',
    female: '女',
    汉: '汉族',
  };
  const first = normalizeChoice(a);
  const second = normalizeChoice(b);
  return !!first && !!second && (aliases[first] || first) === (aliases[second] || second);
}

export function readWidgetValue(trigger: HTMLElement): string {
  const input =
    trigger instanceof HTMLInputElement ||
    trigger instanceof HTMLTextAreaElement ||
    trigger instanceof HTMLSelectElement
      ? trigger
      : nativeValueMember(trigger);
  if (input) return input.value.trim();
  const text = (node: Node): string => {
    if (insideChoicePopup(node, trigger)) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node instanceof Element && node.matches('script,style,noscript,template')) return '';
    return Array.from(node.childNodes, text).join('');
  };
  const value = (trigger.getAttribute('aria-valuetext') ?? text(trigger)).trim();
  return /^(?:请选择|选择|please select|select)(?:[.…]*)$/i.test(value) ? '' : value;
}

function ownedPopup(trigger: HTMLElement): HTMLElement | undefined {
  const ids = new Set(
    [trigger.getAttribute('aria-controls'), trigger.getAttribute('aria-owns')]
      .filter(Boolean)
      .flatMap((value) => value!.trim().split(/\s+/))
      .filter(Boolean),
  );
  if (ids.size > 1) throw new Error('无法唯一确认下拉菜单范围，请手动选择');
  const id = [...ids][0];
  if (!id) return undefined;
  const matches = Array.from(trigger.ownerDocument.querySelectorAll<HTMLElement>('[id]')).filter(
    (element) => element.id === id,
  );
  if (matches.length > 1) throw new Error('下拉菜单编号不唯一，请手动选择');
  const popup = matches[0];
  return popup && popup !== trigger && !popup.contains(trigger) ? popup : undefined;
}

export function assertPopupOwned(
  trigger: HTMLElement,
  popup: HTMLElement,
  context: WidgetContext,
): void {
  assertCurrent(trigger, context);
  if (ownedPopup(trigger) !== popup || !popup.isConnected || !visible(popup))
    throw new Error('下拉菜单范围已变化，已停止操作');
}

export function safeWidgetClick(
  element: HTMLElement,
  trigger: HTMLElement,
  context: WidgetContext,
): void {
  assertCurrent(trigger, context);
  if (!widgetEnabled(element)) throw new Error('选项不可操作，请手动选择');
  const action = element.closest('button,input');
  if (
    (action instanceof HTMLButtonElement && action.form && action.type !== 'button') ||
    (action instanceof HTMLInputElement && ['submit', 'image', 'reset'].includes(action.type)) ||
    element.closest('a[href]')
  )
    throw new Error('此操作可能提交或离开表单，已停止');
  element.click();
}

export async function waitForWidget<T>(
  probe: () => T | undefined | null,
  trigger: HTMLElement,
  context: WidgetContext,
  message: string,
): Promise<T> {
  const deadline = Date.now() + 2000;
  while (true) {
    assertCurrent(trigger, context);
    const result = probe();
    if (result !== undefined && result !== null) return result;
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assertCurrent(trigger, context);
  }
}

export async function openWidgetPopup(
  trigger: HTMLElement,
  context: WidgetContext,
): Promise<HTMLElement> {
  assertCurrent(trigger, context);
  const existing = ownedPopup(trigger);
  if (existing && visible(existing) && trigger.getAttribute('aria-expanded') !== 'false')
    return existing;
  safeWidgetClick(trigger, trigger, context);
  return waitForWidget(
    () => {
      const popup = ownedPopup(trigger);
      return popup && visible(popup) ? popup : undefined;
    },
    trigger,
    context,
    '未找到此字段关联的下拉菜单，请手动选择',
  );
}

/** Escape is the only generic dismissal; never guess at page-wide buttons. */
export function closeWidgetPopup(
  trigger: HTMLElement,
  popup: HTMLElement,
  context: WidgetContext,
): void {
  try {
    assertPopupOwned(trigger, popup, context);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  } catch {
    // User interference or a replaced popup means we must leave it alone.
  }
}
