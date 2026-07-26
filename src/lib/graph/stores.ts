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
/** Module the force "functions" view is focused on (null = all functions). */
export const forceFocus = writable<string | null>(null);
/** What the detail panel is showing. */
export const selection = writable<Selection>(null);
/** Bumped when the user clicks empty graph space — closes the side panel even
 *  when nothing is selected (setting selection null→null won't notify then). */
export const stageClick = writable(0);

/** Label nodes with their plain-English description instead of their name. */
export const plainLabels = writable(false);
/** Colour nodes by test coverage (green tested / red untested) instead of layer. */
export const coverage = writable(false);
/** Force every node's label to show in the force view, ignoring zoom/size culling. */
export const allLabels = writable(false);
/** Groups (file types / layers) toggled OFF in the legend — hidden in the force view. */
export const hiddenGroups = writable<Set<string>>(new Set());
