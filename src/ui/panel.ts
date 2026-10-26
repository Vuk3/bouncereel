import type { Config } from '../config.ts';
import { TABS, type Field, type Section } from './fields.ts';

// Builds the panel's tabs from TABS and keeps them in sync with the config:
// inputs write straight into the config object, refresh() writes back after
// anything else changed it (a matchup, an import, a video opened from the library).

type Input = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface Bound {
  field: Field;
  row: HTMLElement;
  input: Input;
  output?: HTMLOutputElement;
  hint?: HTMLElement;
  chips?: HTMLElement;
  swatches?: HTMLButtonElement[];
}

export function getPath(obj: object, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

export function setPath(obj: object, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, obj as Record<string, unknown>);
  target[last] = value;
}

export class Panel {
  private bound: Bound[] = [];
  private bodies = new Map<string, HTMLElement>();
  private tabs: { button: HTMLButtonElement; panel: HTMLElement }[] = [];
  private readonly config: () => Config;
  private readonly onChange: (field: Field) => void;

  constructor(root: HTMLElement, config: () => Config, onChange: (field: Field) => void) {
    this.config = config;
    this.onChange = onChange;
    const list = document.createElement('div');
    list.className = 'tabs';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Settings');
    root.append(list);
    for (const [index, tab] of TABS.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab';
      button.id = `tab-${tab.id}`;
      button.textContent = tab.title;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `tabpanel-${tab.id}`);
      button.addEventListener('click', () => this.select(index));
      const panel = document.createElement('div');
      panel.className = 'tabpanel';
      panel.id = `tabpanel-${tab.id}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      for (const section of tab.sections) panel.append(this.section(section));
      list.append(button);
      root.append(panel);
      this.tabs.push({ button, panel });
    }
    // Arrow keys move between tabs, as a tab list should.
    list.addEventListener('keydown', (e) => {
      const current = this.tabs.findIndex((t) => t.button === document.activeElement);
      if (current < 0) return;
      const n = this.tabs.length;
      const moves: Partial<Record<string, number>> = { ArrowRight: current + 1, ArrowLeft: current - 1 + n, Home: 0, End: n - 1 };
      const next = moves[e.key];
      if (next === undefined) return;
      e.preventDefault();
      this.select(next % n);
      this.tabs[next % n].button.focus();
    });
    this.select(0);
    this.refresh();
  }

  /** A section's body, for blocks that are not plain fields (the voice list, the voice status, the seed). */
  body(id: string): HTMLElement {
    const body = this.bodies.get(id);
    if (!body) throw new Error(`No section ${id}`);
    return body;
  }

  refresh(): void {
    const cfg = this.config();
    for (const b of this.bound) {
      const { field, input } = b;
      b.row.hidden = field.show ? !field.show(cfg) : false;
      if (field.kind === 'select') this.fillOptions(input as HTMLSelectElement, field.options(cfg));
      if (field.kind === 'textarea' || (field.kind === 'text' && typeof field.placeholder === 'function')) {
        (input as HTMLInputElement | HTMLTextAreaElement).placeholder = typeof field.placeholder === 'function' ? field.placeholder(cfg) : '';
      }
      const value = getPath(cfg, field.path);
      // Leave a text box alone while it is being typed in, or the caret jumps.
      const typing = document.activeElement === input && (field.kind === 'text' || field.kind === 'textarea');
      if (!typing) {
        if (field.kind === 'check') (input as HTMLInputElement).checked = Boolean(value);
        else input.value = String(value ?? '');
      }
      if (b.output && field.kind === 'range') b.output.textContent = field.format ? field.format(Number(value)) : String(value);
      if (b.hint) {
        const hint = typeof field.hint === 'function' ? field.hint(cfg) : (field.hint ?? '');
        b.hint.textContent = hint;
        b.hint.hidden = !hint;
      }
      if (b.chips && field.chips) {
        const chips = field.chips(cfg);
        b.chips.replaceChildren(...chips.map((text) => Object.assign(document.createElement('span'), { className: 'chip', textContent: text })));
        b.chips.hidden = !chips.length;
      }
      for (const swatch of b.swatches ?? []) swatch.setAttribute('aria-pressed', String(swatch.value.toLowerCase() === String(value).toLowerCase()));
    }
  }

  private select(index: number): void {
    for (const [i, { button, panel }] of this.tabs.entries()) {
      const on = i === index;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    }
  }

  private section(section: Section): HTMLElement {
    const el = document.createElement('section');
    el.className = 'group';
    if (section.team) el.dataset.team = section.team;
    const heading = document.createElement('h2');
    heading.textContent = section.title;
    const body = document.createElement('div');
    body.className = 'group-body';
    for (const field of section.fields) body.append(this.build(field));
    el.append(heading, body);
    this.bodies.set(section.id, body);
    return el;
  }

  private build(field: Field): HTMLElement {
    const row = document.createElement('div');
    row.className = `field field-${field.kind}`;
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = field.label;
    let input: Input;
    let output: HTMLOutputElement | undefined;
    let swatches: HTMLButtonElement[] | undefined;

    switch (field.kind) {
      case 'range': {
        const el = document.createElement('input');
        el.type = 'range';
        el.min = String(field.min);
        el.max = String(field.max);
        el.step = String(field.step);
        output = document.createElement('output');
        label.htmlFor = el.id = `field-${field.path.replace(/\./g, '-')}`;
        label.append(name, output);
        row.append(label, el);
        input = el;
        el.addEventListener('input', () => this.commit(field, Number(el.value)));
        break;
      }
      case 'textarea': {
        const el = document.createElement('textarea');
        el.rows = 6;
        el.spellcheck = true;
        label.append(name, el);
        row.append(label);
        input = el;
        el.addEventListener('input', () => this.commit(field, el.value));
        break;
      }
      case 'select': {
        const el = document.createElement('select');
        label.append(name, el);
        row.append(label);
        input = el;
        el.addEventListener('change', () => this.commit(field, el.value));
        break;
      }
      case 'text': {
        const el = document.createElement('input');
        el.type = 'text';
        // One that depends on the config is filled in by refresh().
        el.placeholder = typeof field.placeholder === 'string' ? field.placeholder : '';
        el.spellcheck = false;
        label.append(name, el);
        row.append(label);
        input = el;
        el.addEventListener('input', () => this.commit(field, el.value));
        break;
      }
      case 'color': {
        // The palette the dice uses, one click each, and the system picker for anything else.
        const el = document.createElement('input');
        el.type = 'color';
        el.className = 'swatch-any';
        el.title = 'Any colour';
        el.setAttribute('aria-label', `${field.label}: any colour`);
        el.addEventListener('input', () => this.commit(field, el.value));
        swatches = field.swatches.map((color) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'swatch';
          b.value = color;
          b.style.setProperty('--swatch', color);
          b.setAttribute('aria-label', `${field.label} ${color}`);
          b.addEventListener('click', () => this.commit(field, color));
          return b;
        });
        const group = document.createElement('div');
        group.className = 'swatches';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', field.label);
        group.append(...swatches, el);
        name.className = 'field-label';
        row.append(name, group);
        input = el;
        break;
      }
      case 'check': {
        const el = document.createElement('input');
        el.type = 'checkbox';
        label.append(el, name);
        row.append(label);
        input = el;
        el.addEventListener('change', () => this.commit(field, el.checked));
        break;
      }
    }

    let chips: HTMLElement | undefined;
    if (field.chips) {
      chips = document.createElement('div');
      chips.className = 'chips';
      row.append(chips);
    }
    let hint: HTMLElement | undefined;
    if (field.hint) {
      hint = document.createElement('small');
      hint.className = 'hint';
      row.append(hint);
    }
    input.name = field.path;
    this.bound.push({ field, row, input, output, hint, chips, swatches });
    return row;
  }

  private commit(field: Field, value: unknown): void {
    setPath(this.config(), field.path, value);
    this.onChange(field);
    this.refresh();
  }

  private fillOptions(select: HTMLSelectElement, options: [string, string][]): void {
    const same = select.options.length === options.length && options.every(([v, t], i) => select.options[i].value === v && select.options[i].text === t);
    if (same) return;
    select.replaceChildren(
      ...options.map(([value, text]) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        return o;
      }),
    );
  }
}
