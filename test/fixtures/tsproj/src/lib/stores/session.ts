type Sub = (v: number) => void;

/** A custom store object — no svelte import needed for the extractor to see one. */
export const session = {
  subscribe(fn: Sub): () => void {
    fn(0);
    return () => {};
  }
};
