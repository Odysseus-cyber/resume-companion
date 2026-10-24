import { visible } from './labels';
import type { FieldKind, LayoutRect, LayoutSnapshot } from './types';
import {
  choicePopups,
  choiceSupportReason,
  choiceTriggerSelector,
  deduplicateChoices,
  isChoiceTrigger,
} from './widgets/detect';
import { readWidgetValue } from './widgets/core';

export type LayoutNode = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;
export interface LayoutCandidate {
  nodes: LayoutNode[];
  kind: FieldKind;
  reason?: string;
}
export interface LayoutCollection {
  layout: LayoutSnapshot;
  candidates: LayoutCandidate[];
  /** Original text anchors remain local; only layout may cross the message boundary. */
  textNodes: Node[];
}
const selector = `input,textarea,select,${choiceTriggerSelector},[role="textbox"],[role="listbox"],[role="radio"],[role="checkbox"],[role="switch"],[role="spinbutton"],[contenteditable]:not([contenteditable="false"])`;
const excludedText = `${selector},option,[role="option"],script,style,noscript,template,button,[data-resume-companion]`;
const round = (n: number) => Math.round(n * 10) / 10;
function rect(element: Element): LayoutRect {
  const box = element.getBoundingClientRect();
  return {
    x: round(box.x + window.scrollX),
    y: round(box.y + window.scrollY),
    width: round(box.width),
    height: round(box.height),
  };
}
function textRect(node: Node, parent: Element): LayoutRect {
  const range = document.createRange();
  range.selectNodeContents(node);
  // jsdom has no text geometry; real browsers provide precise positions even
  // when several text labels share a large wrapper.
  if (typeof range.getBoundingClientRect !== 'function') return rect(parent);
  const box = range.getBoundingClientRect();
  return {
    x: round(box.x + window.scrollX),
    y: round(box.y + window.scrollY),
    width: round(box.width),
    height: round(box.height),
  };
}
export function visibleText(node: Node, parent: Element): boolean {
  if (parent.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
  for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return false;
  }
  if (navigator.userAgent.includes('jsdom')) return true;
  const range = document.createRange();
  range.selectNodeContents(node);
  // display:contents has no element box, but its text still has layout boxes.
  return range.getClientRects().length > 0;
}
function occupied(node: LayoutNode): boolean {
  if (isChoiceTrigger(node)) return !!readWidgetValue(node);
  if (node instanceof HTMLInputElement && ['checkbox', 'radio'].includes(node.type))
    return node.checked;
  if (node instanceof HTMLSelectElement && node.multiple) return node.selectedOptions.length > 0;
  if (
    node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement
  )
    return !!node.value;
  return !!node.textContent?.trim();
}
function classify(node: LayoutNode): Pick<LayoutCandidate, 'kind' | 'reason'> {
  if (isChoiceTrigger(node)) {
    const reason = choiceSupportReason(node);
    return reason ? { kind: 'unsupported', reason } : { kind: 'combobox' };
  }
  if (node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true')
    return { kind: 'unsupported', reason: '控件已禁用' };
  if ((node as HTMLInputElement).readOnly || node.getAttribute('aria-readonly') === 'true')
    return { kind: 'unsupported', reason: '只读控件需手动操作' };
  if (node instanceof HTMLInputElement) {
    if (['file', 'password', 'range', 'color'].includes(node.type))
      return { kind: 'unsupported', reason: '此控件需在网页中手动操作' };
    if (['radio', 'checkbox', 'date', 'month'].includes(node.type))
      return { kind: node.type as FieldKind };
    return { kind: 'text' };
  }
  if (node instanceof HTMLTextAreaElement) return { kind: 'textarea' };
  if (node instanceof HTMLSelectElement) return { kind: 'select' };
  return { kind: 'unsupported', reason: '自定义控件暂不支持可靠填写' };
}

/** Captures layout independently of resume dictionaries and label association heuristics. */
export function collectLayout(): LayoutCollection {
  const popups = choicePopups();
  const inPopup = (node: Node) => [...popups].some((popup) => popup.contains(node));
  const all = Array.from(document.querySelectorAll<LayoutNode>(selector)).filter(
    (node) =>
      visible(node) &&
      !inPopup(node) &&
      !node.closest('[data-resume-companion]') &&
      !(
        node instanceof HTMLInputElement &&
        ['hidden', 'submit', 'reset', 'button'].includes(node.type)
      ),
  );
  // An accessible widget wrapping a native control is represented once by the native control.
  const choices = deduplicateChoices(all);
  const controls = choices.filter(
    (node) =>
      !(
        !isChoiceTrigger(node) &&
        !(
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement ||
          node instanceof HTMLSelectElement
        ) &&
        choices.some((child) => child !== node && node.contains(child))
      ),
  );
  if (controls.length > 500) throw new Error('页面候选控件超过 500 个，请缩小识别区域后重试');
  const candidates: LayoutCandidate[] = [];
  const consumed = new Set<LayoutNode>();
  for (const node of controls) {
    if (consumed.has(node)) continue;
    const classification = classify(node);
    let nodes = [node];
    if (
      node instanceof HTMLInputElement &&
      ['radio', 'checkbox'].includes(node.type) &&
      node.name
    ) {
      const group = node.closest('fieldset,[role="group"],[role="radiogroup"]');
      nodes = controls.filter(
        (other) =>
          other instanceof HTMLInputElement &&
          other.type === node.type &&
          other.name === node.name &&
          other.form === node.form &&
          other.closest('fieldset,[role="group"],[role="radiogroup"]') === group,
      );
    }
    nodes.forEach((n) => consumed.add(n));
    const blockedNode = nodes.map(classify).find((c) => c.reason);
    candidates.push({ nodes, ...(blockedNode || classification) });
  }
  const roots = [
    ...new Set(controls.map((node) => node.closest('form,[role="dialog"],main') || document.body)),
  ].filter(
    (root) =>
      !controls.some((node) => {
        const other = node.closest('form,[role="dialog"],main') || document.body;
        return other !== root && other.contains(root);
      }),
  );
  const layout: LayoutSnapshot = {
    containers: [],
    texts: [],
    controls: [],
    limitations: [
      '仅识别顶层页面已展开的表单；iframe、Shadow DOM（含封闭 Shadow DOM）及未展开区域不在本次范围内。',
    ],
  };
  const textNodes: Node[] = [];
  // Keep choice values out of the model and keep the text snapshot stable when
  // our own write selects a radio/checkbox. Question headings remain available.
  const choiceLabels = new Set(
    Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"],input[type="checkbox"]'),
    ).flatMap((input) => Array.from(input.labels || [])),
  );
  const containerIds = new Map<Element, string>();
  let order = 0;
  function container(element: Element): string {
    const known = containerIds.get(element);
    if (known) return known;
    const parentId =
      element.parentElement && roots.some((root) => root.contains(element.parentElement))
        ? container(element.parentElement)
        : null;
    const id = `c${containerIds.size}`;
    containerIds.set(element, id);
    layout.containers.push({ id, parentId, order: order++, rect: rect(element) });
    return id;
  }
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      const text = node.textContent?.replace(/\s+/g, ' ').trim();
      if (
        !parent ||
        !text ||
        inPopup(node) ||
        parent.closest(excludedText) ||
        !visibleText(node, parent)
      )
        continue;
      // Choice labels are option values, including labels associated via for=.
      const choiceLabel = parent.closest('label');
      if (
        choiceLabel &&
        (choiceLabels.has(choiceLabel) ||
          choiceLabel.querySelector('input[type="radio"],input[type="checkbox"]'))
      )
        continue;
      layout.texts.push({
        id: `t${layout.texts.length}`,
        parentId: container(parent),
        order: order++,
        rect: textRect(node, parent),
        text,
      });
      textNodes.push(node);
    }
  }
  candidates.forEach((candidate, index) => {
    const node = candidate.nodes[0]!;
    const parentId = node.parentElement ? container(node.parentElement) : null;
    layout.controls.push({
      id: `f${index}`,
      parentId,
      order: order++,
      rect: rect(node),
      kind: candidate.kind,
      writable: !candidate.reason,
      occupied: candidate.nodes.some(occupied),
      ...(candidate.reason ? { reason: candidate.reason } : {}),
    });
  });
  // Node order is independent of collection pass, exposing both columns and deep wrappers.
  const ranks = new Map<Node, number>();
  const tree = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let ranked: Node | null;
  while ((ranked = tree.nextNode())) ranks.set(ranked, ranks.size + 1);
  layout.containers.forEach((c) => {
    const element = [...containerIds].find(([, id]) => id === c.id)?.[0];
    c.order = element ? ranks.get(element) || 0 : 0;
  });
  layout.texts.forEach((t, index) => {
    t.order = ranks.get(textNodes[index]!) || 0;
  });
  layout.controls.forEach((c, i) => {
    c.order = ranks.get(candidates[i]!.nodes[0]!) || 0;
  });
  return { layout, candidates, textNodes };
}
