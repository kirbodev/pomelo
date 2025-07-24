import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT, type TOptions } from "@sapphire/plugin-i18next";
import type { AutocompleteInteraction } from "discord.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import Fuse from "fuse.js";

export class AutocompleteHandler extends InteractionHandler {
  public constructor(
    ctx: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options
  ) {
    super(ctx, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.Autocomplete,
    });
  }

  public override async run(
    interaction: AutocompleteInteraction,
    result: InteractionHandler.ParseResult<this>
  ) {
    return interaction.respond(result);
  }

  public override async parse(interaction: AutocompleteInteraction) {
    if (interaction.commandName !== "afk") return this.none();

    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name !== "message") return this.none();

    const t = await fetchT(interaction);
    const recommended = t<string, { returnObjects: true } & TOptions, string[]>(
      LanguageKeys.Commands.Utility.Afk.recommended,
      {
        returnObjects: true,
      }
    ).sort(() => Math.random() - 0.5);

    if (focusedOption.value.trim().length === 0)
      return this.some(recommended.map((x) => ({ name: x, value: x })));

    const fuse = new Fuse(recommended, {
      keys: recommended,
      threshold: 0.5,
      distance: 100,
    });
    const results = fuse.search(focusedOption.value.trim()).map((x) => x.item);
    results.push(focusedOption.value.trim());
    return this.some(results.map((x) => ({ name: x, value: x })));
  }
}
