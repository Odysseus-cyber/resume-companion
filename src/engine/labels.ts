const controlSelector = 'input,textarea,select,[role="combobox"]';
const excluded = `${controlSelector},option,[role="option"],script,style,button,[contenteditable]:not([contenteditable="false"])`;
const headingSelector = 'h1,h2,h3,h4,h5,h6,header,legend,[role="heading"]';
const semanticSelector = 'label,[class*="label"],[data-label]';
const plainSelector = 'span,div,p,dt,dd,td,th';

function styleVisible(element: Element): boolean {
  if (element.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return false;
  }
  return true;
}
export function visible(element: HTMLElement): boolean {
  return (
    styleVisible(element) &&
    (element.getClientRects().length > 0 || navigator.userAgent.includes('jsdom'))
  );
}

// Inspect the live tree: cloning loses stylesheet-dependent visibility. Never
// include values from controls, editable elements or their descendants.
export function staticText(element: Element | null): string {
  if (!element || element.closest(excluded) || !styleVisible(element)) return '';
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof Element) || node.matches(excluded) || !styleVisible(node)) return '';
    return Array.from(node.childNodes, read).join(' ');
  };
  return read(element).replace(/\s+/g, ' ').trim();
}

const generic =
  /^(?:未命名字段|请输入|请选择|请填写|输入|选择|必填|选填|开始|结束|从|至|到|please\s+(?:enter|select|choose)|enter|select|choose)(?:[\s.…:：*]*|(?:内容|信息|日期|时间))$/i;
function meaningful(text: string): boolean {
  return !!text && !generic.test(text) && !/^[\s*：:—\-/\d]+$/.test(text);
}
function plausible(text: string): boolean {
  return (
    text.length > 0 &&
    text.length <= 64 &&
    !/[。！？!?；;]/.test(text) &&
    !/^https?:/i.test(text) &&
    !/^(?:欢迎|感谢|温馨提示|加入我们|我们期待|请阅读|请仔细阅读)/.test(text)
  );
}
function directText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function controls(element: Element): Element[] {
  return Array.from(element.querySelectorAll(controlSelector)).filter((node) =>
    visible(node as HTMLElement),
  );
}
function candidates(wrapper: Element, target: HTMLElement): string[] {
  const results: string[] = [];
  const add = (text: string) => {
    const clean = text.replace(/^[\s*]+|[\s*：:]+$/g, '');
    if (plausible(clean) && meaningful(clean) && !results.includes(clean)) results.push(clean);
  };
  const walk = (node: Element, depth: number) => {
    if (depth > 4 || node.matches(excluded) || node.matches(headingSelector) || !styleVisible(node))
      return;
    const targetId = node.getAttribute('for');
    if (targetId && targetId !== target.id) return;
    if (node !== wrapper && controls(node).length) return;
    const eligible = node.matches(`${semanticSelector},${plainSelector}`);
    if (eligible && !controls(node).length) {
      const text = staticText(node);
      if (plausible(text)) {
        add(text);
        return;
      }
      // A paragraph is explanatory prose, not a bag of individual field names.
      if (node.matches('p')) return;
    }
    if (eligible) add(directText(node));
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(wrapper, 0);
  return results.slice(0, 4);
}

export interface LabelInfo {
  label: string;
  context: string[];
  bindingStable: boolean;
}
export function labelInfo(el: HTMLElement): LabelInfo {
  const by = el.getAttribute('aria-labelledby');
  const explicit = [
    by
      ?.split(/\s+/)
      .map((id) => staticText(document.getElementById(id)))
      .join(' ')
      .trim(),
    el.getAttribute('aria-label'),
    Array.from((el as HTMLInputElement).labels || [], staticText)
      .join(' ')
      .trim(),
    staticText(el.closest('label')),
  ].find(Boolean);
  if (explicit) return { label: explicit, context: [], bindingStable: meaningful(explicit) };
  let wrapper = el.parentElement;
  let context: string[] = [];
  for (let depth = 0; wrapper && wrapper !== document.body && depth < 4; depth++) {
    const nearby = candidates(wrapper, el);
    context = [...new Set([...context, ...nearby])].slice(0, 4);
    const count = controls(wrapper).length;
    // Shared date ranges and sibling fields expose context only. Choosing a
    // shared title as every control's label creates incorrect remembered maps.
    if (count !== 1) break;
    if (nearby.length === 1) return { label: nearby[0]!, context, bindingStable: true };
    if (nearby.length > 1) break;
    wrapper = wrapper.parentElement;
  }
  const placeholder = el.getAttribute('placeholder')?.trim();
  return {
    label: placeholder || el.getAttribute('name') || el.id || '未命名字段',
    context,
    // Machine-generated names/ids can change or repeat and do not establish
    // stable meaning. Only an actual descriptive placeholder can do so here.
    bindingStable: !!placeholder && meaningful(placeholder),
  };
}
export function labelOf(el: HTMLElement): string {
  return labelInfo(el).label;
}
