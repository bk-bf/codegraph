import { clamp } from '$lib/core/util';

export class Greeter {
  constructor(private who: string) {}

  greet(times: number): string {
    return 'hi '.repeat(clamp(times, 1, 3)) + this.who;
  }
}

/** Object-literal registry: each value is its own node. */
export const handlers = {
  loud: (g: Greeter) => g.greet(3),
  quiet: (g: Greeter) => g.greet(1)
};

export function greetAll(gs: Greeter[]): string[] {
  return gs.map((g) => handlers.loud(g));
}
