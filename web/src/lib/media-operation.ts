/** SDK commands also run in handlers, timers and cleanup, outside React boundaries. */
export function tryMediaOperation(action: () => void, platform: string, onFailure?: () => void): boolean {
  try {
    action();
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console -- preserve the SDK error for diagnosis, without interrupting navigation
    console.error(`CRV: error del reproductor de ${platform}`, error);
    onFailure?.();
    return false;
  }
}
