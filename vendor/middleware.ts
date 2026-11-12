import type { ChoMiddlewareFn } from "../core/di/types.ts";

export function compose_middlewares(
  middlewares: ChoMiddlewareFn[],
): ChoMiddlewareFn {
  return async (ctx, next) => {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }

      index = i;
      const fn = middlewares[i] ?? next;

      if (!fn) {
        return;
      }

      await fn(ctx, () => dispatch(i + 1));
      return;
    };

    return dispatch(0);
  };
}
