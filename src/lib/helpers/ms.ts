// Modify ms to not allow negative values and seconds as the default unit
import msOriginal from "ms";

const numberRegex = /^\d+$/;

/**
 * A modified version of the ms function that does not allow negative values and assumes seconds as the default unit
 * @param val
 * @returns The value in milliseconds if a string is provided, or a human-readable string if a number is provided
 */
export default function ms<T extends string | number>(
  val: T,
  options?: T extends number ? { long: boolean } : never
): T extends string ? number : string {
  if (typeof val === "number")
    return msOriginal(val, options) as T extends string ? number : string;

  const int = parseInt(val, 10);
  // If it's a number and ONLY a number, we assume it's in seconds
  if (!isNaN(int) && numberRegex.test(val))
    return (int * 1000) as T extends string ? number : string;
  const parsed = msOriginal(val);
  if (parsed < 0) return NaN as T extends string ? number : string;

  return parsed as T extends string ? number : string;
}
