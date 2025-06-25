import { UserError, type Command } from "@sapphire/framework";
import {
  applyLocalizedBuilder,
  fetchT,
  type TFunction,
} from "@sapphire/plugin-i18next";
import { Subcommand } from "@sapphire/plugin-subcommands";
import {
  ActionRowBuilder,
  ButtonStyle,
  ComponentType,
  Locale,
  Message,
  type ModalActionRowComponentBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonComponentData,
  type InteractionButtonComponentData,
  type SelectMenuComponentOptionData,
  type TextInputComponentData,
  ChannelType,
  SelectMenuDefaultValueType,
  type APISelectMenuDefaultValue,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRow,
  type JSONEncodable,
  type APIActionRowComponent,
  ChannelSelectMenuBuilder,
  StringSelectMenuComponent,
  type APIStringSelectComponent,
  type APIChannelSelectComponent,
  ChannelSelectMenuComponent,
  ButtonComponent,
  type APIButtonComponentWithCustomId,
  ButtonBuilder,
  MessageFlags,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import { GuildSettings, UserSettings } from "../../db/redis/schema.js";
import { set, z } from "zod";
import ComponentUtils from "../../utilities/componentUtils.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { nanoid } from "nanoid";
import Locales, { supportedLocales } from "../../lib/i18n/locales.js";
import type {
  PaginatedMessageAction,
  PaginatedMessageActionButton,
  PaginatedMessageActionChannelMenu,
  PaginatedMessageActionContext,
  PaginatedMessageActionStringMenu,
} from "@sapphire/discord.js-utilities";
import { objectEntries } from "@sapphire/utilities";
import CommandUtils from "../../utilities/commandUtils.js";
import { Colors } from "../../lib/colors.js";
import { fallbackLanguage, getBoolean } from "../../lib/i18n/utils.js";
import { Emojis } from "../../lib/emojis.js";
import { getMinMax, internationalizeError } from "../../lib/helpers/zod.js";

type SettingData =
  | {
    name: string;
    description: string;
    type: "text";
    subType?: "number";
    currentValue?: string;
    overridden?: boolean;
  }
  | {
    name: string;
    description: string;
    type: "select";
    selectType?: ComponentType.StringSelect;
    options: SelectMenuComponentOptionData[];
    currentValue?: string;
    overridden?: boolean;
  }
  | {
    name: string;
    description: string;
    type: "select";
    selectType?: ComponentType.ChannelSelect;
    channelTypes?: ChannelType[];
    currentValue?: string;
    overridden?: boolean;
  }
  | {
    name: string;
    description: string;
    type: "boolean";
    currentValue?: boolean;
    overridden?: boolean;
  };

export class UserCommand extends CommandUtils.PomeloSubcommand {
  private menuId = nanoid();

  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options
  ) {
    super(context, {
      ...options,
      name: "settings",
      description: "Manage settings for the bot.",
      subcommands: [
        {
          name: "guild",
          messageRun: "messageRunGuild",
          chatInputRun: "chatInputRunGuild",
          runIn: "GUILD_ANY",
        },
        {
          name: "user",
          messageRun: "messageRunUser",
          chatInputRun: "chatInputRunUser",
        },
      ],
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      detailedDescription: {
        syntax: "<guild|user>",
        examples: ["guild", "user"],
      },
    });
  }

  registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Utility.Settings.commandName,
        LanguageKeys.Commands.Utility.Settings.commandDescription
      )
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand((builder) =>
          applyLocalizedBuilder(
            builder,
            LanguageKeys.Commands.Utility.Settings.subcommandGuildName,
            LanguageKeys.Commands.Utility.Settings.subcommandGuildDescription
          )
        )
        .addSubcommand((builder) =>
          applyLocalizedBuilder(
            builder,
            LanguageKeys.Commands.Utility.Settings.subcommandUserName,
            LanguageKeys.Commands.Utility.Settings.subcommandUserDescription
          )
        );
    });
  }

  public async messageRunGuild(message: Message) {
    this.executeGuild(message);
  }

  public async chatInputRunGuild(
    interaction: Command.ChatInputCommandInteraction
  ) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
    this.executeGuild(interaction);
  }

  private async executeGuild(
    interaction: Command.ChatInputCommandInteraction | Message
  ) {
    const t = await fetchT(interaction);
    if (!interaction.guildId) return;
    let settings = await this.container.redis.jsonGet(
      interaction.guildId,
      "GuildSettings"
    );
    if (!settings) {
      settings = GuildSettings.parse({
        locale: fallbackLanguage(
          interaction.guild?.preferredLocale ?? Locale.EnglishUS
        ),
      } as z.infer<typeof GuildSettings>);
      await this.container.redis.jsonSet(
        interaction.guildId,
        "GuildSettings",
        settings
      );
    }

    //ANCHOR - When adding new settings, add them here (and respectively to the user settings)
    const validFields = new Map<keyof typeof GuildSettings.shape, SettingData>()
      .set("forceLocale", {
        name: t(LanguageKeys.Settings.Guild.forceLocale.name),
        description: t(LanguageKeys.Settings.Guild.forceLocale.description),
        type: "boolean",
        currentValue: settings.forceLocale,
      })
      .set("prefix", {
        name: t(LanguageKeys.Settings.Guild.prefix.name),
        description: t(LanguageKeys.Settings.Guild.prefix.description),
        type: "text",
        currentValue: settings.prefix,
      })
      .set("logChannel", {
        name: t(LanguageKeys.Settings.Guild.logChannel.name),
        description: t(LanguageKeys.Settings.Guild.logChannel.description),
        type: "select",
        selectType: ComponentType.ChannelSelect,
        currentValue: settings.logChannel,
      })
      .set("forceEphemeral", {
        name: t(LanguageKeys.Settings.Guild.forceEphemeral.name),
        description: t(LanguageKeys.Settings.Guild.forceEphemeral.description),
        type: "boolean",
        currentValue: settings.forceEphemeral,
      })
      .set("ephemeralDeletionTimeout", {
        name: t(LanguageKeys.Settings.Guild.ephemeralDeletionTimeout.name),
        description: t(
          LanguageKeys.Settings.Guild.ephemeralDeletionTimeout.description
        ),
        type: "text",
        subType: "number",
        currentValue: settings.ephemeralDeletionTimeout?.toString(),
      });

    this.createSettingsEmbed(
      "guild",
      interaction.guildId,
      interaction,
      validFields
    );
  }

  public async messageRunUser(message: Message) {
    this.executeUser(message);
  }

  public async chatInputRunUser(
    interaction: Command.ChatInputCommandInteraction
  ) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
    this.executeUser(interaction);
  }

  private async executeUser(
    interaction: Command.ChatInputCommandInteraction | Message
  ) {
    const t = await fetchT(interaction);
    const user =
      interaction instanceof Message ? interaction.author : interaction.user;
    let settings = await this.container.redis.jsonGet(user.id, "UserSettings");
    if (!settings) {
      settings = UserSettings.parse({
        locale: fallbackLanguage(
          interaction instanceof Message ? Locale.EnglishUS : interaction.locale
        ),
      } as z.infer<typeof UserSettings>);
      await this.container.redis.jsonSet(user.id, "UserSettings", settings);
    }
    const guildSettings = interaction.guildId
      ? await this.container.redis.jsonGet(interaction.guildId, "GuildSettings")
      : null;

    const validFields = new Map<
      keyof typeof UserSettings.shape,
      SettingData
    >().set("preferEphemeral", {
      name: t(LanguageKeys.Settings.User.preferEphemeral.name),
      description: t(LanguageKeys.Settings.User.preferEphemeral.description),
      type: "boolean",
      currentValue: settings.preferEphemeral,
      overridden: guildSettings?.forceEphemeral ?? false,
    });

    this.createSettingsEmbed("user", user.id, interaction, validFields);
  }

  private getLanguageSelectMenuOptions(currentLocale: keyof typeof Locales) {
    // Locale is available for both guild and user settings
    const locales = Object.entries(supportedLocales).map(([key, value]) => {
      return {
        label: value.name,
        value: key,
        emoji: value.emoji,
        default: key === currentLocale,
      };
    });
    return locales;
  }

  private async createSettingEmbed(
    name: string,
    description: string,
    t: TFunction, // use T so its not refreshed when language changes
    defaultValue?: string,
    currentValue?: string,
    overridden?: boolean
  ) {
    const title = t(name);
    const desc = t(description);
    const current = t(LanguageKeys.Settings.Current);
    const defTitle = t(LanguageKeys.Settings.Default.name);
    const defDesc = t(LanguageKeys.Settings.Default.description, {
      default: defaultValue,
    });
    const overrideTitle = `${Emojis.EditOff} ${t(
      LanguageKeys.Settings.Override.name
    )}`;
    const overrideDesc = t(LanguageKeys.Settings.Override.description);

    if (defaultValue && (defaultValue === "true" || defaultValue === "false"))
      defaultValue = getBoolean(t, defaultValue === "true");

    if (currentValue && (currentValue === "false" || currentValue === "true"))
      currentValue = getBoolean(t, currentValue === "true");

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(title)
      .setDescription(desc);

    if (overridden) embed.addField(overrideTitle, overrideDesc);
    if (defaultValue) embed.addField(defTitle, defDesc);
    if (currentValue) embed.addField(current, currentValue);

    return embed;
  }

  private async createSettingsEmbed<T extends "guild" | "user">(
    type: T,
    id: string,
    interaction: Command.ChatInputCommandInteraction | Message,
    validFields: Map<
      T extends "user"
      ? keyof typeof UserSettings.shape
      : keyof typeof GuildSettings.shape,
      SettingData
    >
  ) {
    const t = await fetchT(interaction);
    this.menuId = nanoid();
    let menu = new ComponentUtils.MenuPaginatedMessage({
      cache: false,
    });

    const schema = type === "user" ? UserSettings : GuildSettings;
    let settings = (await this.container.redis.jsonGet(
      id,
      `${type === "user" ? "User" : "Guild"}Settings`
    )) as z.infer<typeof schema>;

    // Add the locale
    menu
      .addAsyncPageEmbed(async () => {
        settings = (await this.container.redis.jsonGet(
          id,
          `${type === "user" ? "User" : "Guild"}Settings`
        )) as z.infer<typeof schema>;
        const langEmbed = await this.createSettingEmbed(
          LanguageKeys.Settings.Guild.locale.name,
          LanguageKeys.Settings.Guild.locale.description,
          t,
          this.getDefault(type, "locale")?.toString(),
          settings.locale
        );
        return langEmbed;
      })
      .addPageAction(
        this.createStringSelectMenu(
          "locale",
          type,
          this.getLanguageSelectMenuOptions(settings.locale),
          menu
        ),
        menu.pages.length - 1
      );

    for (const [name, setting] of validFields) {
      let action: PaginatedMessageAction;
      let defaultValue = this.getDefault(type, name)?.toString();
      let currentValue = setting.currentValue;

      if (setting.type === "select") {
        if (!setting.selectType)
          setting.selectType = ComponentType.StringSelect;

        if (setting.selectType === ComponentType.StringSelect) {
          action = this.createStringSelectMenu(
            name,
            type,
            setting.options,
            menu
          );
        } else if (setting.selectType === ComponentType.ChannelSelect) {
          defaultValue = defaultValue
            ? this.makeIdReadable(defaultValue, "channel")
            : defaultValue;
          currentValue = currentValue
            ? this.makeIdReadable(currentValue as string, "channel")
            : currentValue;
          action = this.createChannelSelectMenu(
            name,
            type,
            menu,
            setting.channelTypes,
            setting.currentValue
              ? {
                id: setting.currentValue,
                type: SelectMenuDefaultValueType.Channel,
              }
              : undefined
          );
        } else continue;
      } else if (setting.type === "text") {
        let { min, max } =
          setting.subType === "number"
            ? {
              min: undefined,
              max: undefined,
            }
            : getMinMax(schema, name as keyof typeof schema.shape);
        action = this.createTextModal(type, name, t, {
          label: setting.name,
          minLength: min,
          maxLength: max,
          value: setting.currentValue,
          placeholder: defaultValue,
        });
      } else if (setting.type === "boolean") {
        action = this.createBooleanButton(
          name,
          type,
          menu,
          currentValue as boolean
        );
      } else continue;

      menu.addAsyncPageEmbed(async () => {
        const updatedSetting = await this.container.redis.jsonGet(
          id,
          `${type === "user" ? "User" : "Guild"}Settings`
        );
        let updatedValue = updatedSetting
          ? objectEntries(updatedSetting).find(([key]) => key === name)?.[1]
          : null;
        // Make sure the value is in the correct format
        if (
          setting.type === "select" &&
          setting.selectType === ComponentType.ChannelSelect
        )
          updatedValue = updatedValue
            ? this.makeIdReadable(updatedValue.toString(), "channel")
            : updatedValue;
        const embed = await this.createSettingEmbed(
          setting.name,
          setting.description,
          t,
          defaultValue,
          updatedValue?.toString() ?? currentValue?.toString(),
          setting.overridden
        );
        return embed;
      });
      menu.addPageAction(action, menu.pages.length - 1);
    }

    menu.run(interaction);
  }

  private async setSetting<T extends "user" | "guild">(
    type: T,
    id: string,
    setting: T extends "user"
      ? keyof typeof UserSettings.shape
      : keyof typeof GuildSettings.shape,
    value:
      | z.infer<typeof UserSettings>[keyof typeof UserSettings.shape]
      | z.infer<typeof GuildSettings>[keyof typeof GuildSettings.shape],
    interaction:
      | StringSelectMenuInteraction
      | ChannelSelectMenuInteraction
      | ButtonInteraction
  ) {
    const t = await fetchT(interaction);
    const schema = type === "user" ? UserSettings : GuildSettings;
    // refetching the settings is intentional
    let settings = await this.container.redis.jsonGet(
      id,
      `${type === "user" ? "User" : "Guild"}Settings`
    );
    if (!settings)
      throw new UserError({
        identifier: "genericError",
        message: "Settings not found",
      });
    settings = {
      ...settings,
      [setting]: value,
    };
    const { success, data, error } = schema.safeParse(settings);
    if (!success) {
      const errorMessage = await internationalizeError(error, interaction);
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(errorMessage.title)
        .setDescription(errorMessage.desc)
        .setColor(Colors.Error);
      return embed;
    }
    // Data is better to use in case any coercion or post-processing is needed
    const isSet = await this.container.redis.jsonSet(
      id,
      `${type === "user" ? "User" : "Guild"}Settings`,
      data
    );
    if (!isSet) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(t(LanguageKeys.Errors.ServerError.title))
        .setDescription(t(LanguageKeys.Errors.ServerError.desc))
        .setColor(Colors.Error);
      return embed;
    }

    return null;
  }

  private getDefault<T extends "user" | "guild">(
    type: T,
    setting: T extends "user"
      ? keyof typeof UserSettings.shape
      : keyof typeof GuildSettings.shape
  ) {
    const schema = type === "user" ? UserSettings : GuildSettings;
    const entry = objectEntries(schema.shape).find(
      ([key]) => key === setting
    )?.[1];
    const defaultValue =
      entry instanceof z.ZodDefault ? entry._def.defaultValue() : null;
    return defaultValue;
  }

  private createStringSelectMenu<T extends "guild" | "user">(
    name: T extends "user"
      ? keyof typeof UserSettings.shape
      : keyof typeof GuildSettings.shape,
    type: T,
    options: SelectMenuComponentOptionData[],
    menu: InstanceType<typeof ComponentUtils.MenuPaginatedMessage>
  ) {
    // check if options is an array of strings
    options.splice(25);

    const selectMenu: PaginatedMessageActionStringMenu = {
      type: ComponentType.StringSelect,
      customId: `${this.menuId}-${name}`,
      options,
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isStringSelectMenu())
          throw new UserError({
            identifier: "genericError",
            message:
              "Incorrect menu type triggered - expected string select menu, received " +
              interaction.type,
          });
        const optionValue = interaction.values[0];
        const id =
          type === "user"
            ? interaction.user.id
            : (interaction.guildId as string); /* atp guildId exists */

        const error = await this.setSetting(
          type,
          id,
          name,
          optionValue,
          interaction
        );

        // Edit the components to make the current value the selected one
        // Only string select menus can be here
        const newComponents = interaction.message.components as (
          | ActionRow<StringSelectMenuComponent>
          | JSONEncodable<APIActionRowComponent<APIStringSelectComponent>>
        )[];
        // Remove the last value (the current one)
        newComponents.pop();
        newComponents.push(
          new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(
            new StringSelectMenuBuilder(
              this.createStringSelectMenu(
                name,
                type,
                options.map((o) => ({
                  ...o,
                  default: o.value === optionValue,
                })),
                menu
              )
            )
          )
        );

        // Set the new component on the menu
        menu.setPageActions(
          newComponents
            .map((c) => c.toJSON().components)
            .flat()
            .map((c) => {
              if (!("custom_id" in c)) return null;
              const action = menu.pageActions.at(menu.index)?.get(c.custom_id);
              if (action?.type !== ComponentType.StringSelect) return null;
              action.options = c.options;
              return action;
            })
            .filter((a) => a !== null),
          menu.index
        );

        return {
          embeds: [
            await this.confirmSettingChange(interaction, optionValue, error),
          ],
          components: newComponents,
          ephemeral: true,
          edit: true,
        };
      },
    };

    return selectMenu;
  }

  //NOTE - "Label" should be passed into options, the english name will be used by default but won't be translated
  private createBooleanButton<T extends "guild" | "user">(
    name: T extends "user"
      ? keyof typeof UserSettings.shape
      : keyof typeof GuildSettings.shape,
    type: T,
    menu: InstanceType<typeof ComponentUtils.MenuPaginatedMessage>,
    currentState: boolean,
    data?: InteractionButtonComponentData
  ) {
    const options: InteractionButtonComponentData = {
      customId: `${this.menuId}-${name}`,
      style: currentState ? ButtonStyle.Success : ButtonStyle.Secondary,
      label: "Toggle",
      type: ComponentType.Button,
      ...data,
    };

    const button: PaginatedMessageActionButton = {
      ...options,
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isButton())
          throw new UserError({
            identifier: "genericError",
            message:
              "Incorrect menu type triggered - expected button, received " +
              interaction.type,
          });
        // When in success, the value is false
        const optionValue = interaction.component.style !== ButtonStyle.Success;
        const id =
          type === "user"
            ? interaction.user.id
            : (interaction.guildId as string); /* atp guildId exists */

        const error = await this.setSetting(
          type,
          id,
          name,
          optionValue,
          interaction
        );

        // Edit the components to make the current value the selected one
        // Only string select menus can be here
        const newComponents = interaction.message.components as (
          | ActionRow<ButtonComponent | StringSelectMenuComponent>
          | JSONEncodable<
            APIActionRowComponent<
              APIButtonComponentWithCustomId | APIStringSelectComponent
            >
          >
        )[];
        // Remove the last value (the current one)
        newComponents.pop();
        newComponents.push(
          new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder(
              this.createBooleanButton(name, type, menu, optionValue, data)
            )
          ) as JSONEncodable<
            APIActionRowComponent<APIButtonComponentWithCustomId>
          >
        );

        // Set the new component on the menu
        menu.setPageActions(
          newComponents
            .map((c) => c.toJSON().components)
            .flat()
            .map((c) => {
              if (!("custom_id" in c)) return null;
              const action = menu.pageActions.at(menu.index)?.get(c.custom_id);
              return action ?? null;
            })
            .filter((a) => a !== null),
          menu.index
        );

        return {
          embeds: [
            await this.confirmSettingChange(
              interaction,
              `${optionValue}`,
              error
            ),
          ],
          components: newComponents,
          ephemeral: true,
          edit: true,
        };
      },
    };

    return button;
  }

  private createChannelSelectMenu<T extends "guild" | "user">(
    name: T extends "user"
      ? keyof typeof UserSettings.shape
      : keyof typeof GuildSettings.shape,
    type: T,
    menu: InstanceType<typeof ComponentUtils.MenuPaginatedMessage>,
    channelTypes?: ChannelType[],
    defaultValue?: APISelectMenuDefaultValue<SelectMenuDefaultValueType.Channel>
  ) {
    const selectMenu: PaginatedMessageActionChannelMenu = {
      type: ComponentType.ChannelSelect,
      customId: `${this.menuId}-${name}`,
      minValues: 1,
      maxValues: 1,
      defaultValues: defaultValue ? [defaultValue] : undefined,
      channelTypes: channelTypes ?? [ChannelType.GuildText],
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isChannelSelectMenu())
          throw new UserError({
            identifier: "genericError",
            message:
              "Incorrect menu type triggered - expected channel select menu, received " +
              interaction.type,
          });
        const optionValue = interaction.values[0];
        const id =
          type === "user"
            ? interaction.user.id
            : (interaction.guildId as string); /* atp guildId exists */
        const error = await this.setSetting(
          type,
          id,
          name,
          optionValue,
          interaction
        );

        // Edit the components to make the current value the selected one
        const newComponents: (
          | ActionRow<ChannelSelectMenuComponent | StringSelectMenuComponent>
          | JSONEncodable<
            APIActionRowComponent<
              APIChannelSelectComponent | APIStringSelectComponent
            >
          >
        )[] = interaction.message.components as (
          | ActionRow<ChannelSelectMenuComponent | StringSelectMenuComponent>
          | JSONEncodable<
            APIActionRowComponent<
              APIChannelSelectComponent | APIStringSelectComponent
            >
          >
        )[];
        // Remove the last value (the current one)
        newComponents.pop();
        newComponents.push(
          new ActionRowBuilder<ChannelSelectMenuBuilder>().setComponents(
            new ChannelSelectMenuBuilder(
              this.createChannelSelectMenu(name, type, menu, channelTypes, {
                id: optionValue,
                type: SelectMenuDefaultValueType.Channel,
              })
            )
          )
        );

        // Set the new component on the menu
        menu.setPageActions(
          newComponents
            .map((c) => c.toJSON().components)
            .flat()
            .map((c) => {
              const action = menu.pageActions.at(menu.index)?.get(c.custom_id);
              if (
                action?.type !== ComponentType.StringSelect &&
                action?.type !== ComponentType.ChannelSelect
              )
                return null;
              if (action.type === ComponentType.StringSelect) {
                c = c as APIStringSelectComponent;
                action.options = c.options;
              } else if (action.type === ComponentType.ChannelSelect) {
                c = c as APIChannelSelectComponent;
                action.channelTypes = c.channel_types;
                action.defaultValues = c.default_values;
              }
              action.disabled = c.disabled;
              action.placeholder = c.placeholder;
              action.minValues = c.min_values;
              action.maxValues = c.max_values;
              return action;
            })
            .filter((a) => a !== null),
          menu.index
        );

        return {
          embeds: [
            await this.confirmSettingChange(
              interaction,
              this.makeIdReadable(optionValue, "channel"),
              error
            ),
          ],
          components: newComponents,
          ephemeral: true,
          edit: true,
        };
      },
    };

    return selectMenu;
  }

  // NOTE - "Label" should be passed into options, the name will be used by default but won't be translated
  private createTextModal<T extends "guild" | "user">(
    type: T,
    name: T extends "user"
      ? keyof typeof UserSettings.shape
      : keyof typeof GuildSettings.shape,
    t: TFunction,
    options?: Partial<Omit<TextInputComponentData, "customId">>,
    buttonOpts?: Partial<Omit<InteractionButtonComponentData, "customId">>
  ) {
    const textInputOptions: TextInputComponentData = {
      customId: `${this.menuId}-${name}`,
      label: name,
      minLength: 1,
      required: true,
      style: TextInputStyle.Short,
      type: ComponentType.TextInput,
      ...options,
    };
    const buttonOptions: ButtonComponentData = {
      customId: `${this.menuId}-${name}`,
      label: t(LanguageKeys.Settings.Change),
      style: ButtonStyle.Primary,
      type: ComponentType.Button,
      ...buttonOpts,
    };

    const modal = new ModalBuilder()
      .setTitle(textInputOptions.label)
      .setComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().setComponents(
          new TextInputBuilder(textInputOptions)
        )
      );

    const textModal: PaginatedMessageActionButton = {
      ...buttonOptions,
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isButton())
          throw new UserError({
            identifier: "genericError",
            message:
              "Incorrect menu type triggered - expected button, received " +
              interaction.type,
          });
        // Set random id to prevent conflicts
        const modalId = nanoid();
        modal.setCustomId(modalId);
        await interaction.showModal(modal);
        const modalResult = await interaction
          .awaitModalSubmit({
            time: 1000 * 60 * 5,
            filter: (i) =>
              i.customId === modalId && i.user.id === interaction.user.id,
          })
          .catch(() => null);
        if (!modalResult) {
          await this.container.utilities.componentUtils.disableButtons(
            interaction.message
          );
          return;
        }
        const value = modalResult.components[0].components[0].value;
        const id =
          type === "user"
            ? interaction.user.id
            : (interaction.guildId as string);
        const error = await this.setSetting(type, id, name, value, interaction);

        await modalResult.deferUpdate();
        await modalResult.editReply({
          embeds: [await this.confirmSettingChange(interaction, value, error)],
          components: interaction.message.components,
        });

        //  Returning null explictly means to not update the message
        return null;
      },
    };

    return textModal;
  }

  private async confirmSettingChange(
    interaction:
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ChannelSelectMenuInteraction,
    value: string,
    error: EmbedBuilder | null
  ) {
    const embed = new EmbedBuilder(interaction.message.embeds[0].data);
    embed.setColor(error ? Colors.Error : Colors.Success);

    if (!error) {
      const editedField =
        interaction.message.embeds[0].fields[
        interaction.message.embeds[0].fields.length - 1
        ];
      editedField.value = value;
      embed.setFields([
        ...interaction.message.embeds[0].fields.slice(
          0,
          interaction.message.embeds[0].fields.length - 1
        ),
        editedField,
      ]);
    } else {
      interaction.followUp({
        embeds: [error],
        flags: MessageFlags.Ephemeral,
      });
    }

    const REVERSE_COLOR_TIME = 2500;
    // Revert the color after 2.5 seconds
    setTimeout(() => {
      interaction.editReply({
        embeds: [embed.setColor(Colors.Default)],
      });
    }, REVERSE_COLOR_TIME);

    return embed;
  }

  private makeIdReadable(id: string, type: "user" | "channel" | "role") {
    if (type === "user") return `<@${id}>`;
    if (type === "channel") return `<#${id}>`;
    if (type === "role") return `<@&${id}>`;
    return id;
  }
}
