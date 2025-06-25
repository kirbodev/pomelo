import { T, type CapitalizedObjectKeys } from "../types/utils.js";
import args from "../../languages/en-US/arguments.json" with { type: "json" };

export default {
  Cancel: T("general:cancel"),
  Confirm: T("general:confirm"),
  Close: T("general:close"),
  Na: T("general:na"),
  No: T("general:no"),
  Yes: T("general:yes"),
  Disable: T("general:disable"),
  Enable: T("general:enable"),
  BooleanFalseOptions: T("arguments:booleanFalseOptions"),
  BooleanTrueOptions: T("arguments:booleanTrueOptions"),
} as CapitalizedObjectKeys<typeof args>;
