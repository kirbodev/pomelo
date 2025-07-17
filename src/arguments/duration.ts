import { Argument } from "@sapphire/framework";
import { LanguageKeyValues } from "../lib/i18n/languageKeys.js";
import ms from "../lib/helpers/ms.js";

interface DurationArgumentType {
  value: number;
  rawTime: string;
}

export class CoreArgument extends Argument<DurationArgumentType> {
  public run(parameter: string, context: Argument.Context) {
    const time = ms(parameter);

    if (isNaN(time))
      return this.error({
        parameter,
        context,
        identifier: LanguageKeyValues.Errors.InvalidDuration,
      });

    return this.ok({
      value: time,
      rawTime: parameter,
    });
  }
}

declare module "@sapphire/framework" {
  interface ArgType {
    duration: DurationArgumentType;
  }
}
