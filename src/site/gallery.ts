// The site's recorded clips, on the home page and the game pages: real videos played from whole
// files, each only while it is half on screen.

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Workers Assets answer a Range request with the whole file (200), and Safari plays a video or a
 * sound only from range answers (206): served as they are, the gallery and the opening would not
 * play there at all. So the page fetches each file whole, once, when it is first wanted, and plays
 * it from a blob URL, which needs no ranges. The returned function resolves once `src` is set.
 */
export function wholeFile(media: HTMLMediaElement, url: string): () => Promise<void> {
  let ready: Promise<void> | null = null;
  return () =>
    (ready ??= fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${url}: ${r.status}`))))
      .then((blob) => {
        media.src = URL.createObjectURL(blob);
      })
      .catch((err: unknown) => {
        ready = null;
        throw err;
      }));
}

/**
 * The gallery: real videos, each playing (muted, looping) only while it is half on screen, and
 * its button to pause it, after which the screen does not start it again. Without JS each keeps
 * the browser's own controls; under reduced motion nothing starts by itself, the button plays it.
 * Leaving the screen pauses a video either way. The button says what is wanted, so it answers
 * at once while the file is still on its way.
 */
export function gallery(): void {
  for (const phone of document.querySelectorAll<HTMLElement>('.gallery-phone')) {
    const video = phone.querySelector('video')!;
    const press = phone.querySelector<HTMLButtonElement>('.gallery-play')!;
    const load = wholeFile(video, video.src);
    video.controls = false;
    press.hidden = false;
    let wanted = false;
    let held = false;
    const want = (on: boolean) => {
      wanted = on;
      press.setAttribute('aria-pressed', String(on));
      if (!on) video.pause();
      else
        load()
          .then(() => (wanted ? video.play() : undefined))
          .catch(() => want(false));
    };
    press.addEventListener('click', () => {
      held = wanted;
      want(!wanted);
    });
    // A pause that is not the page's (the system's media controls) shows on the button too.
    video.addEventListener('pause', () => wanted && want(false));
    // The ratio, not isIntersecting: that is already true at the first pixel on screen.
    new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio < 0.5) want(false);
        else if (!held && !reducedMotion) want(true);
      },
      { threshold: 0.5 },
    ).observe(video);
  }
}
