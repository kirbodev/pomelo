import { CommandInteraction, Message } from "discord.js";
import { config } from "../config.js";
import { AllFlowsPrecondition } from "@sapphire/framework";
import { LanguageKeyValues } from "../lib/i18n/languageKeys.js";

export class OwnerOnlyPrecondition extends AllFlowsPrecondition {
  public override messageRun(message: Message) {
    return this.execute(message.author.id);
  }

  public override chatInputRun(interaction: CommandInteraction) {
    return this.execute(interaction.user.id);
  }

  public override contextMenuRun(interaction: CommandInteraction) {
    return this.execute(interaction.user.id);
  }

  private execute(id: string) {
    return config.owners.includes(id)
      ? this.ok()
      : this.error({
          identifier: LanguageKeyValues.Errors.DevOnly,
        });
  }
}

declare module "@sapphire/framework" {
  interface Preconditions {
    OwnerOnly: never;
  }
}
