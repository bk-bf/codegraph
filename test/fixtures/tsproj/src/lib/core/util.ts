/** Clamp a value into a range. */
export function clamp(v: number, lo: number, hi: number): number {
  // Declared inside clamp: a nested node whose parent is clamp.
  const bounded = (x: number): number => (x < lo ? lo : x > hi ? hi : x);
  return bounded(v);
}

/** Reached by nothing, so testDepth stays null. */
export function unreachable(): string {
  return 'nobody calls this';
}
