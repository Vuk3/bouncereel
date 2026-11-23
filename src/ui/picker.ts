// A select you can type into: the studio's pickers of flags (Arena Clash) and of clubs and players
// (Goal Rush). It shows the picked one with its picture; typing filters the list as you go and
// forgives: "srb" finds Serbia (its letters in order), "erb" finds it too (inside the name),
// "zvezda" finds Red Star Belgrade (a name it is also called), "barca" Barcelona, "modric" Modrić
// (accents are ignored). Arrows move, Enter picks, Escape puts it back as it was.
//
// The list is fixed to the window, under the box (over it when the window has no room below),
// and follows it while the panel scrolls: the cards it sits in clip what overflows them, for their
// rounded corners.

export interface PickerItem {
  id: string;
  label: string;
  /** A picture before the label: a flag's file, a kit's data URL, a crest or a photo. */
  icon?: string;
  /** `contain` for a picture that must show whole on a light ground (a crest), rather than fill its circle. */
  fit?: 'contain';
  /** Small, after the label: a club's league, a player's country. */
  hint?: string;
  /** Other names the search matches: nicknames, local names, codes. */
  keys?: string[];
}

/** Lowercase, accents and the letters they sit on taken apart, and the few letters NFD keeps whole. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/đ/g, 'dj')
    .replace(/ł/g, 'l')
    .replace(/ı/g, 'i')
    .replace(/[’'`.]/g, '');
}

/**
 * How well `query` (folded) matches `text` (folded), 0 for not at all: the whole of it first, then
 * its start, a word's start, anywhere inside it, and last its letters in order with gaps ("srb" in
 * serbia), the tighter the better. Several words must each match somewhere ("real m").
 */
export function matchScore(query: string, text: string): number {
  if (!query) return 1;
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    let sum = 0;
    for (const w of words) {
      const s = matchScore(w, text);
      if (!s) return 0;
      sum += s;
    }
    return sum / words.length + (text.includes(query) ? 20 : 0);
  }
  if (text === query) return 100;
  if (text.startsWith(query)) return 90;
  const at = text.indexOf(query);
  if (at > 0 && /[\s-]/.test(text[at - 1])) return 80;
  if (at > 0) return 60 - Math.min(10, at);
  // The letters in order, starting at a word's start: the tighter the span, the better.
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== query[0] || (start > 0 && !/[\s-]/.test(text[start - 1]))) continue;
    let j = 1;
    let i = start + 1;
    for (; i < text.length && j < query.length; i++) if (text[i] === query[j]) j++;
    if (j === query.length) return Math.max(5, 40 - (i - start - query.length) * 2);
  }
  return 0;
}

/** The items matching `query`, best first, the list's own order between equals. */
export function search(items: PickerItem[], query: string): PickerItem[] {
  const q = fold(query.trim());
  if (!q) return items;
  return items
    .map((item, i) => {
      const score = Math.max(matchScore(q, fold(item.label)), ...(item.keys ?? []).map((k) => matchScore(q, fold(k)) * 0.95));
      return { item, i, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((m) => m.item);
}

let count = 0;

export class Picker {
  readonly el: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly icon: HTMLImageElement;
  private readonly list: HTMLUListElement;
  private items: PickerItem[] = [];
  private shown: PickerItem[] = [];
  private active = 0;
  private current = '';
  private readonly onPick: (id: string) => void;
  /** Keeps the open list under its box as the panel scrolls or the window changes. */
  private readonly follow = () => this.place();

  /** `label` names it for a screen reader ("Flag 2", "Home"). */
  constructor(label: string, onPick: (id: string) => void) {
    this.onPick = onPick;
    const id = `picker-${++count}`;
    this.el = document.createElement('div');
    this.el.className = 'picker';
    this.icon = Object.assign(document.createElement('img'), { alt: '', width: 26, height: 26, decoding: 'async', className: 'picker-icon' });
    this.input = Object.assign(document.createElement('input'), { type: 'text', className: 'picker-input', autocomplete: 'off', spellcheck: false });
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-label', label);
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.setAttribute('aria-controls', `${id}-list`);
    this.list = Object.assign(document.createElement('ul'), { className: 'picker-list', id: `${id}-list`, hidden: true });
    this.list.setAttribute('role', 'listbox');
    const caret = document.createElement('span');
    caret.className = 'picker-caret';
    caret.setAttribute('aria-hidden', 'true');
    this.el.append(this.icon, this.input, caret, this.list);

    this.input.addEventListener('focus', () => {
      this.input.select();
      this.open('');
    });
    this.input.addEventListener('input', () => this.open(this.input.value));
    this.input.addEventListener('keydown', (e) => this.key(e));
    this.input.addEventListener('blur', () => {
      // A click on the list lands after the blur: give it a moment, then put the name back.
      window.setTimeout(() => {
        if (document.activeElement !== this.input) this.close();
      }, 120);
    });
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-id]');
      if (row) this.pick(row.dataset.id!);
    });
    this.list.addEventListener('mousemove', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-index]');
      if (row) this.highlight(Number(row.dataset.index), false);
    });
  }

  /** What it offers; the picked one stays as it is. */
  setItems(items: PickerItem[]): void {
    this.items = items;
    this.show();
  }

  get value(): string {
    return this.current;
  }

  set value(id: string) {
    this.current = id;
    this.show();
  }

  /** The picked one in the box: its picture and its name, unless it is being typed into. */
  private show(): void {
    const item = this.items.find((i) => i.id === this.current);
    if (item?.icon) {
      if (this.icon.getAttribute('src') !== item.icon) this.icon.src = item.icon;
      this.icon.classList.toggle('contain', item.fit === 'contain');
      this.icon.hidden = false;
    } else this.icon.hidden = true;
    if (document.activeElement !== this.input) this.input.value = item?.label ?? this.current;
  }

  private open(query: string): void {
    this.shown = search(this.items, query);
    // At most 60 rows: a typed letter or two narrows it, and a list of 200 is not read anyway.
    const rows = this.shown.slice(0, 60).map((item, index) => {
      const row = document.createElement('li');
      row.setAttribute('role', 'option');
      row.dataset.id = item.id;
      row.dataset.index = String(index);
      if (item.icon) row.append(Object.assign(document.createElement('img'), { src: item.icon, alt: '', width: 22, height: 22, decoding: 'async', loading: 'lazy', className: item.fit ?? '' }));
      row.append(Object.assign(document.createElement('span'), { textContent: item.label }));
      if (item.hint) row.append(Object.assign(document.createElement('small'), { textContent: item.hint }));
      if (item.id === this.current) row.classList.add('picked');
      return row;
    });
    if (!rows.length) rows.push(Object.assign(document.createElement('li'), { className: 'picker-none', textContent: 'Nothing by that name' }));
    this.list.replaceChildren(...rows);
    if (this.list.hidden) {
      window.addEventListener('scroll', this.follow, true);
      window.addEventListener('resize', this.follow);
    }
    this.list.hidden = false;
    this.place();
    this.input.setAttribute('aria-expanded', 'true');
    // Typing puts the best match first; an empty box starts at the picked one.
    const at = query ? 0 : Math.max(0, this.shown.findIndex((i) => i.id === this.current));
    this.highlight(Math.min(at, rows.length - 1), true);
  }

  /** The list under the box, as wide as it, up to 300 px tall; over it when the window has no room below. */
  private place(): void {
    const box = this.input.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - 12;
    const above = box.top - 12;
    const up = below < 220 && above > below;
    const room = Math.min(300, up ? above : below);
    Object.assign(this.list.style, {
      left: `${box.left}px`,
      width: `${box.width}px`,
      maxHeight: `${Math.max(120, room)}px`,
      top: up ? '' : `${box.bottom + 4}px`,
      bottom: up ? `${window.innerHeight - box.top + 4}px` : '',
    });
  }

  private close(): void {
    window.removeEventListener('scroll', this.follow, true);
    window.removeEventListener('resize', this.follow);
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.show();
  }

  private highlight(index: number, scroll: boolean): void {
    const rows = this.list.querySelectorAll<HTMLLIElement>('li[data-index]');
    if (!rows.length) return;
    this.active = Math.max(0, Math.min(rows.length - 1, index));
    rows.forEach((row, i) => {
      row.classList.toggle('active', i === this.active);
      row.id = i === this.active ? `${this.list.id}-active` : '';
    });
    this.input.setAttribute('aria-activedescendant', `${this.list.id}-active`);
    if (scroll) rows[this.active].scrollIntoView({ block: 'nearest' });
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.list.hidden) this.open('');
      this.highlight(this.active + (e.key === 'ArrowDown' ? 1 : -1), true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = this.shown[this.active];
      if (!this.list.hidden && item) this.pick(item.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      this.input.blur();
    }
  }

  private pick(id: string): void {
    this.input.blur();
    this.close();
    const changed = id !== this.current;
    this.current = id;
    this.show();
    if (changed) this.onPick(id);
  }
}
