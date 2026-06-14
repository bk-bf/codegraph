import { writable } from 'svelte/store';

export type ViewMode = 'layered' | 'modules' | 'functions';
export type ListType = 'functions' | 'calls' | 'files' | 'modules';

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

/** Label nodes with their plain-English description instead of their name. */
export const plainLabels = writable(false);
/** Colour nodes by test coverage (green tested / red untested) instead of layer. */
export const coverage = writable(false);
