// Group → colour, matching the original viewer's palette.
export const GROUP_COLORS: Record<string, string> = {
  core: '#57c7ff',
  services: '#f5a623',
  systems: '#ff6b9d',
  stores: '#7ee787',
  entities: '#c792ea',
  utils: '#8b94a3',
  dev: '#4b5563',
  webgl: '#5cd9c7',
  world: '#e0af68',
  components: '#ff8a5c',
  routes: '#ffd166',
  rust: '#dea584',
  database: '#9ece6a',
  ai: '#bb9af7'
};

export const groupColor = (g: string): string => GROUP_COLORS[g] ?? '#8b94a3';
