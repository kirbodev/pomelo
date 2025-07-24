import { capitalizeFirstLetter } from "@sapphire/utilities";

export function arrayToEnum<T extends string>(
  arr: T[]
): { [K in T as Capitalize<K>]: K } {
  return arr.reduce((acc, k) => {
    const cap = capitalizeFirstLetter(k);
    // @ts-expect-error - We know this is safe
    acc[cap] = k;
    return acc;
    // eslint-disable-next-line @typescript-eslint/prefer-reduce-type-parameter
  }, {} as { [K in T as Capitalize<K>]: K });
}

export function T<TCustom = string>(k: string): TypedT<TCustom> {
  return k as TypedT<TCustom>;
}

export type StringLiteralUnion<T extends string[]> = T extends (infer U)[]
  ? U
  : never;

export type CapitalizedObjectKeys<T> = {
  [K in keyof T as Capitalize<string & K>]: T[K];
};

export type TypedT<TCustom = string> = string & { __type__: TCustom };
export type GetTypedT<T extends TypedT<unknown>> = T extends TypedT<infer U>
  ? U
  : never;

export type TypedFT<TArgs, TReturn = string> = string & {
  __args__: TArgs;
  __return__: TReturn;
};
export type GetTypedFTArgs<T extends TypedFT<unknown, unknown>> =
  T extends TypedFT<infer U, unknown> ? U : never;
export type GetTypedFTReturn<T extends TypedFT<unknown, unknown>> =
  T extends TypedFT<unknown, infer U> ? U : never;

export function FT<TArgs, TReturn = string>(
  k: string
): TypedFT<TArgs, TReturn> {
  return k as TypedFT<TArgs, TReturn>;
}

export function ArrayT<T>(k: string): Array<T> {
  return k as unknown as Array<T>;
}

export type NullPartial<T> = { [P in keyof T]?: T[P] | null };
