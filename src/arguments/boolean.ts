import { Argument, Resolvers } from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";

export class CoreArgument extends Argument<boolean> {
  public async run(parameter: string, context: Argument.Context) {
    const t = await fetchT(context.message);
    let truths = t(LanguageKeys.Arguments.BooleanTrueOptions).split(",");
    let falses = t(LanguageKeys.Arguments.BooleanFalseOptions).split(",");

    if (!truths.length) truths = this.getDefaultTruthValues;
    if (!falses.length) falses = this.getDefaultFalseValues;

    truths.push(...this.permanentTruthValues);
    falses.push(...this.permanentFalseValues);

    return Resolvers.resolveBoolean(parameter, { truths, falses }) //
      .mapErrInto((identifier) =>
        this.error({ parameter, identifier, context })
      );
  }

  private permanentTruthValues = ["true"];
  private permanentFalseValues = ["false"];

  private get getDefaultTruthValues() {
    return LanguageKeys.Arguments.BooleanTrueOptions.split(",");
  }

  private get getDefaultFalseValues() {
    return LanguageKeys.Arguments.BooleanFalseOptions.split(",");
  }
}
