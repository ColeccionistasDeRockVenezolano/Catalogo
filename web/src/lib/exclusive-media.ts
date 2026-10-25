/** One audible source per catalog window, including cross-origin embeds. */
let current: { owner: string; stop: () => void } | null = null;

export function claimMedia(owner: string, stop: () => void) {
  if (current?.owner !== owner) {
    const previous = current;
    current = null;
    previous?.stop();
  }
  current = { owner, stop };
}

export function releaseMedia(owner: string) {
  if (current?.owner === owner) current = null;
}
