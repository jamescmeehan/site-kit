/**
 * Drives a /disable-tracking/ page: visiting opts this browser out of GTM, and an
 * already opted-out visitor gets a button to undo it. The page owns its markup and
 * styling; this owns the storage key's behaviour. Run it in the page's <script>.
 *
 * @param {object} options
 * @param {string} options.storageKey localStorage key the GTM loader reads.
 * @param {string} options.siteName The domain, as worded in the messages.
 * @param {Record<'status'|'detail'|'enable'|'disable', string>} [options.ids] Element ids.
 */
export function initTrackingOptOut({
  storageKey,
  siteName,
  ids = { status: 'gtm-status', detail: 'gtm-detail', enable: 'gtm-enable', disable: 'gtm-disable' },
}) {
  const status = document.getElementById(ids.status);
  const detail = document.getElementById(ids.detail);
  const enableBtn = document.getElementById(ids.enable);
  const disableBtn = document.getElementById(ids.disable);

  const read = () => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return null; }
  };
  const write = (on) => {
    try {
      if (on) localStorage.setItem(storageKey, '1');
      else localStorage.removeItem(storageKey);
    } catch { /* read() reports it */ }
    return read();
  };

  function show(state) {
    enableBtn.hidden = !(state === 'set' || state === 'already');
    disableBtn.hidden = state !== 'enabled';
    if (state === 'unavailable') {
      status.textContent = 'Can’t save the setting';
      detail.textContent = 'This browser is blocking site storage (private window or blocked site data), so the opt-out can’t be kept.';
    } else if (state === 'enabled') {
      status.textContent = 'Tracking is on';
      detail.textContent = `Google Tag Manager will load on ${siteName} in this browser again, from the next page you open.`;
    } else {
      status.textContent = state === 'already' ? 'Tracking was already off' : 'Tracking is now off';
      detail.textContent = `Google Tag Manager (GA4 and Google Ads tags) won’t load on ${siteName} in this browser. It only covers this browser and this site, and clearing site data undoes it.`;
    }
  }

  const was = read();
  if (was === null) show('unavailable');
  else if (was) show('already');
  else show(write(true) ? 'set' : 'unavailable');

  enableBtn.addEventListener('click', () => show(write(false) === false ? 'enabled' : 'unavailable'));
  disableBtn.addEventListener('click', () => show(write(true) ? 'set' : 'unavailable'));
}
