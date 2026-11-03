// Installable-app support: the offline service worker and the browser's install prompt.

/**
 * Registers sw.js on the deployed build only — scripts/build-pages.mjs stamps
 * <meta name="hush-build"> — so a development server never ends up serving cached files.
 */
export function registerServiceWorker() {
  if (!document.querySelector('meta[name="hush-build"]') || !('serviceWorker' in navigator)) return;
  const register = () =>
    navigator.serviceWorker
      .register('sw.js')
      .catch((err) => console.warn('hush pond: offline support is unavailable', err));
  // after the page's own loading, so the worker's precache doesn't compete with it
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/**
 * Shows `button` while the browser offers to install the app (Chromium's beforeinstallprompt).
 * Browsers without that event (Safari, Firefox) never show it; iOS installs via Share → Add to Home Screen.
 */
export function setupInstallButton(button) {
  let offer = null;
  const hide = () => {
    offer = null;
    button.hidden = true;
  };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep the mini-infobar away; our own button asks instead
    offer = e;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', hide);
  button.addEventListener('click', async () => {
    if (!offer) return;
    const prompt = offer;
    hide(); // an install offer can be used only once
    await prompt.prompt();
  });
}
