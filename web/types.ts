import { ChoWebContext } from "./context.ts";

export type InputFactory = (c: ChoWebContext) => Promise<unknown>;

// types for middleware and guards

// compiled types

/**
 * Interface for input validators that can safely parse and validate data.
 */
export type Validator = {
  safeParse: (
    data: unknown,
  ) => { success: boolean; data: unknown; error: unknown };
};

/**
 * Validator interface for method arguments with safe parsing capabilities.
 */
export type ArgValidator = {
  safeParse: (
    data: unknown,
  ) => { success: boolean; data: unknown; error: unknown };
};
/**
 * Types of arguments that can be extracted from HTTP requests.
 */
export type ArgType = "param" | "query" | "header" | "body" | "cookie";

/**
 * Configuration for a method argument, specifying how to extract and validate data from the request.
 */
export type MethodArgType<AT = ArgType> = {
  type: AT;
  key?: string;
  validator?: ArgValidator;
};
