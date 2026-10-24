import { bindThemeToggle } from '../ui/theme.ts';

// What every public page runs: the theme toggle in the header (the same one as the studio's).
// The signed-in hint and the saved theme are applied before first paint, in the head
// (src/site/partials/head.html).

const toggle = document.querySelector<HTMLElement>('#theme');
if (toggle) bindThemeToggle(toggle);
