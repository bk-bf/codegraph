import { writable } from 'svelte/store';

export type ViewMode = 'layered' | 'modules' | 'functions';

export type Selection =
  | { type: 'node'; id: string }
  | { type: 'module'; module: string }
  | { type: 'edge'; from: string; to: string; kind: 'module' | 'fn' }
  | null;

/** Current view: layered Mermaid overview/drilldown, or sigma force (modules/functions). */
export const viewMode = writable<ViewMode>('layered');
/** Module the Mermaid view is drilled into (null = overview). */
export const focusModule = writable<string | null>(null);
/** What the detail panel is showing. */
export const selection = writable<Selection>(null);
