import Errors from "./errors.js";
import Args from "./arguments.js";
import Commands from "./commands/index.js";
import { objectKeys } from "@sapphire/utilities";
import { arrayToEnum } from "../types/utils.js";
import Settings from "./settings.js";
import Messages from "./messages.js";

export const LanguageKeys = {
  Errors,
  Arguments: Args,
  Commands,
  Settings,
  Messages,
} as const;

export const LanguageKeyValues = {
  Errors: arrayToEnum(objectKeys(Errors)),
  Arguments: arrayToEnum(objectKeys(Args)),
  Commands: arrayToEnum(objectKeys(Commands)),
  Settings: arrayToEnum(objectKeys(Settings)),
  Messages: arrayToEnum(objectKeys(Messages)),
} as const;
