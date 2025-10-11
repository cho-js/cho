/**
 * Command context
 * Minimist args API
 */
export type ChoArgs = {
  _: string[];
  [key: string]: boolean | string | number | string[] | undefined;
};

/**
 * Command context
 * Provide access to args and other context data
 * todo complete implementation
 */
export class ChoCommandContext {
  constructor(readonly args: ChoArgs) {
  }
}
