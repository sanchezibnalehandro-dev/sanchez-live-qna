// Backwards-compatible KDW entry point.
// The renderer now lives in the shared ModeratorLive guest component.
import { initGuestNetworkBackground } from './guest-network-background.js';
export { KDW_BACKGROUND_CHOICE } from './guest-network-background.js';

export function initKdwGuestBackground(surface = 'welcome') {
  if (document.documentElement.dataset.brand !== 'kdw-2026') return () => {};
  return initGuestNetworkBackground(surface);
}
