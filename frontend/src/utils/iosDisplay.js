export function isIosDevice(userAgent = '', navigatorLike = null) {
  if (/iPhone|iPad|iPod/i.test(userAgent || '')) return true;
  return navigatorLike?.platform === 'MacIntel' && Number(navigatorLike.maxTouchPoints || 0) > 1;
}

export function isStandaloneDisplay(win = null) {
  if (!win) return false;
  return Boolean(win.matchMedia?.('(display-mode: standalone)')?.matches || win.navigator?.standalone);
}
