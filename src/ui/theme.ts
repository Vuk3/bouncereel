/** Read by the boot script in every page's head too, before first paint. */
const THEME_KEY = 'bouncereel:theme';

/**
 * Light or dark for the page around the video (the video keeps its own colours).
 * Light unless dark was chosen. Where view transitions exist, the new theme spreads
 * from the button as a circle (the theme-flip rules in style.css).
 */
export function bindThemeToggle(button: HTMLElement): void {
  const root = document.documentElement;
  const label = () => {
    const text = root.dataset.theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme';
    button.title = text;
    button.setAttribute('aria-label', text);
  };
  const apply = () => {
    const dark = root.dataset.theme !== 'dark';
    if (dark) root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // Storage unavailable: the choice lasts until reload.
    }
    label();
  };
  label();
  button.addEventListener('click', () => {
    if (typeof document.startViewTransition !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply();
      return;
    }
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    root.style.setProperty('--flip-x', `${x}px`);
    root.style.setProperty('--flip-y', `${y}px`);
    root.style.setProperty('--flip-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    root.dataset.themeFlip = '';
    void document.startViewTransition(apply).finished.finally(() => delete root.dataset.themeFlip);
  });
}
