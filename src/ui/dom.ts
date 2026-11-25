/**
 * Tiny helper for building HTML elements in code, so views read like:
 *   h('button', { class: 'big', onclick: save }, 'Save')
 */
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key === 'style') {
      el.setAttribute('style', String(value));
    } else if (key in el && key !== 'list') {
      // properties like value, checked, disabled, hidden
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  if (tag === 'button' && IOS) addHapticLayer(el as HTMLButtonElement);
  return el;
}

/*
 * iPhone haptics experiment: iOS gives a little "tick" when you tap an on/off
 * switch, but websites can't trigger it from code. So every button gets an
 * invisible switch laid over it — your finger taps the switch (tick!) and the
 * tap still reaches the button as usual.
 */
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || localStorage.getItem('liftlog.forceHaptics') === '1';

export function addHapticLayer(button: HTMLButtonElement): void {
  if (!IOS || button.querySelector('.hap')) return;
  const label = document.createElement('label');
  label.className = 'hap';
  label.ariaHidden = 'true';
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.tabIndex = -1;
  // The label also fires a click on the switch; stop that one so the button doesn't run twice.
  sw.addEventListener('click', (e) => e.stopPropagation());
  label.appendChild(sw);
  button.appendChild(label);
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace everything inside `el` with new children. */
export function mount(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
