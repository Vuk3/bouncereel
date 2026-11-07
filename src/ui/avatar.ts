// A person's round picture: their profile picture, else their initials on a colour picked by
// their id. The account page, the top bars on the way to it, and the admin area's people. The look
// is .avatar in src/style.css, which every page behind the sign-in loads.

export interface Person {
  id: number;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
}

/** The name to show for an account: its first and last name, else its address. */
export function displayName(p: Person): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `account ${p.id}`;
}

/** Up to two letters: of the names, else the address's first. By code point, so "Đ" stays whole. */
function initials(p: Person): string {
  const fromNames = [p.firstName, p.lastName].flatMap((n) => (n ? [[...n][0]] : [])).join('');
  return (fromNames || [...(p.email ?? '?')][0]).toUpperCase();
}

export function avatar(p: Person, size: 'small' | 'large' | 'xl' = 'small'): HTMLElement {
  const node = document.createElement('span');
  node.className = size === 'small' ? 'avatar' : `avatar ${size}`;
  node.style.setProperty('--avatar', p.id % 2 ? '#6a46ff' : '#0277b6');
  node.setAttribute('aria-hidden', 'true');
  if (p.avatarUrl) {
    const img = Object.assign(document.createElement('img'), { src: p.avatarUrl, alt: '', decoding: 'async' });
    // A picture replaced or removed since the page loaded: the initials, not a broken image.
    img.addEventListener('error', () => node.replaceChildren(initials(p)), { once: true });
    node.append(img);
  } else {
    node.textContent = initials(p);
  }
  return node;
}
