import { Events, Listener } from "@sapphire/framework";
import type { AutoModerationRule } from "discord.js";
import { EditListener } from "./preventAutomodRuleEdit.js";

export class DeletionListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options
  ) {
    super(context, {
      ...options,
      event: Events.AutoModerationRuleDelete,
    });
  }

  public async run(rule: AutoModerationRule) {
    return EditListener.handler(rule, true);
  }
}
