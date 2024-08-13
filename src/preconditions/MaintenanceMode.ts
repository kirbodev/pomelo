import { config, maintainanceMode } from "../config.js";
import { AllFlowsPrecondition, Precondition } from "@sapphire/framework";
import { LanguageKeyValues } from "../lib/i18n/languageKeys.js";
import type {
  ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  Message,
} from "discord.js";

export class MaintenancePrecondition extends AllFlowsPrecondition {
  constructor(context: Precondition.LoaderContext) {
    super(context, {
      position: 20,
    });
  }

  public override messageRun(interaction: Message) {
    return this.execute(interaction.author.id);
  }

  public override chatInputRun(interaction: ChatInputCommandInteraction) {
    return this.execute(interaction.user.id);
  }

  public override contextMenuRun(interaction: ContextMenuCommandInteraction) {
    return this.execute(interaction.user.id);
  }

  private execute(id: string) {
    const { on, reason } = maintainanceMode.get();
    return !on
      ? this.ok()
      : config.owners.includes(id)
      ? this.ok()
      : this.error({
          identifier: LanguageKeyValues.Errors.MaintenanceMode as string,
          context: reason
            ? {
                reason: reason,
              }
            : {},
        });
  }
}

declare module "@sapphire/framework" {
  interface Preconditions {
    MaintenanceMode: never;
  }
}
