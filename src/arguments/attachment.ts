import { Argument } from "@sapphire/framework";
import { LanguageKeyValues } from "../lib/i18n/languageKeys.js";
import ms from "../lib/helpers/ms.js";

interface AttachmentArgumentContext extends Argument.Context {
  allowedExtensions?: string[];
}

const URL_REGEX =
  /https:\/\/(?<subdomain>media|cdn)\.?(?<hostname>dis(?:cord)?app)\.(?<tld>com|net)\/[\w/.-]*\.(?<extension>[^.?]+)(?=[?])[\w?&=]+/i;

export class CoreArgument extends Argument<string> {
  public async run(parameter: string, context: AttachmentArgumentContext) {
    const url = parameter.match(URL_REGEX);
    if (!url)
      return this.error({
        parameter,
        context,
        identifier: LanguageKeyValues.Errors.InvalidAttachment,
      });

    if (context.allowedExtensions) {
      const extension = url.groups?.extension;
      if (!extension || !context.allowedExtensions.includes(extension))
        return this.error({
          parameter,
          context: {
            ...context,
            types: context.allowedExtensions.join(", "),
          },
          identifier: LanguageKeyValues.Errors.InvalidAttachment,
        });
    }

    return this.ok(parameter);
  }
}

declare module "@sapphire/framework" {
  interface ArgType {
    attachment: string;
  }
}
