import { UserError, type Command } from "@sapphire/framework";
import { applyLocalizedBuilder, fetchT, type TFunction } from "@sapphire/plugin-i18next";
import { Subcommand } from "@sapphire/plugin-subcommands";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SelectMenuDefaultValueType,
  StringSelectMenuBuilder,
  StringSelectMenuComponent,
  TextInputBuilder,
  TextInputStyle,
  type ActionRow,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIChannelSelectComponent,
  type APIStringSelectComponent,
  type ButtonComponent,
  type ButtonInteraction,
  type ChannelSelectMenuComponent,
  type ChannelSelectMenuInteraction,
  type EmbedData,
  type JSONEncodable,
  type SelectMenuComponentOptionData,
  type StringSelectMenuInteraction,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import { QrScanner, type QrScannerSettings } from "../../db/redis/schema.js";
import ComponentUtils from "../../utilities/componentUtils.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { nanoid } from "nanoid";
import CommandUtils from "../../utilities/commandUtils.js";
import { Colors } from "../../lib/colors.js";
import { getBoolean } from "../../lib/i18n/utils.js";
import type {
  PaginatedMessageAction,
  PaginatedMessageActionButton,
  PaginatedMessageActionChannelMenu,
  PaginatedMessageActionContext,
  PaginatedMessageActionStringMenu,
} from "@sapphire/discord.js-utilities";
import type {
  InteractionButtonComponentData,
} from "discord.js";

type QrSettingData =
  | {
      name: string;
      description: string;
      type: "text";
      currentValue?: string;
    }
  | {
      name: string;
      description: string;
      type: "select";
      selectType?: ComponentType.StringSelect;
      options: SelectMenuComponentOptionData[];
      currentValue?: string;
    }
  | {
      name: string;
      description: string;
      type: "select";
      selectType?: ComponentType.ChannelSelect;
      currentValue?: string;
    }
  | {
      name: string;
      description: string;
      type: "boolean";
      currentValue?: boolean;
    };

const REVERSE_COLOR_TIME = 2500;

export class SecuritySettingsCommand extends CommandUtils.PomeloSubcommand {
  private menuId = nanoid();

  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: "securitysettings",
      description: "Manage security features for the server.",
      requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
      preconditions: ["GuildOnly"],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Moderation.SecuritySettings.commandName,
        LanguageKeys.Commands.Moderation.SecuritySettings.commandDescription,
      )
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand((sub) =>
          applyLocalizedBuilder(
            sub,
            LanguageKeys.Commands.Moderation.SecuritySettings.subcommandQrName,
            LanguageKeys.Commands.Moderation.SecuritySettings.subcommandQrDescription,
          ).setName("qr"),
        )
        .addSubcommand((sub) =>
          applyLocalizedBuilder(
            sub,
            LanguageKeys.Commands.Moderation.SecuritySettings.subcommandQuickstartName,
            LanguageKeys.Commands.Moderation.SecuritySettings.subcommandQuickstartDescription,
          ).setName("quickstart"),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === "qr") {
      await this.executeQrSettings(interaction);
      return;
    }

    if (subcommand === "quickstart") {
      await this.executeQuickstart(interaction);
      return;
    }
  }

  private async executeQuickstart(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const { createQrQuickstartState, renderQrQuickstart, qrQuickstartRepository } =
      await import("../../interaction-handlers/qrQuickstart.js");

    const guildId = interaction.guildId!;
    const t = await fetchT(interaction);

    const state = createQrQuickstartState({
      id: `qr-qs-${nanoid()}`,
      ownerId: interaction.user.id,
      guildId,
      messageId: "pending",
    });

    const existing = await this.container.redis.jsonGet(guildId, "QrScanner");
    if (existing) {
      state.step = 4;
      state.settings = existing;
    }

    const reply = await interaction.editReply({
      components: renderQrQuickstart(state, t),
      flags: MessageFlags.IsComponentsV2,
    });
    const message = await reply.fetch();
    state.messageId = message.id;
    await qrQuickstartRepository.save(state);
  }

  private async executeQrSettings(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const guildId = interaction.guildId!;
    const t = await fetchT(interaction);

    let settings = await this.container.redis.jsonGet(guildId, "QrScanner");
    if (!settings) {
      settings = QrScanner.parse({
        mode: "off",
        customAllowlist: [],
        customBlocklist: [],
        defaultAllowlistEnabled: false,
        defaultBlocklistEnabled: false,
        safeAction: {},
        unsafeAction: {},
      });
      await this.container.redis.jsonSet(guildId, "QrScanner", settings);
    }

    const sk = LanguageKeys.Commands.Moderation.SecuritySettings;

    const validFields = new Map<string, QrSettingData>()
      .set("mode", {
        name: t(sk.qrMode),
        description: t(sk.qrDescMode),
        type: "select",
        selectType: ComponentType.StringSelect,
        options: [
          { label: t(sk.qrModeAllowlist), value: "allowlist", default: settings.mode === "allowlist" },
          { label: t(sk.qrModeBlocklist), value: "blocklist", default: settings.mode === "blocklist" },
          { label: t(sk.qrModeOff), value: "off", default: settings.mode === "off" },
        ],
        currentValue: settings.mode,
      });

    if (settings.mode === "blocklist") {
      validFields.set("defaultBlocklistEnabled", {
        name: t(sk.qrDefaultBlocklist),
        description: t(sk.qrDescDefaultBlocklist),
        type: "boolean",
        currentValue: settings.defaultBlocklistEnabled,
      });
    }

    validFields
      .set("safeAction.enabled", {
        name: t(sk.qrSafeActionLabel),
        description: t(sk.qrDescSafeAction),
        type: "boolean",
        currentValue: settings.safeAction.enabled,
      })
      .set("safeAction.channelId", {
        name: t(sk.qrSafeChannel),
        description: t(sk.qrDescSafeChannel),
        type: "select",
        selectType: ComponentType.ChannelSelect,
        currentValue: settings.safeAction.channelId ?? undefined,
      })
      .set("unsafeAction.enabled", {
        name: t(sk.qrUnsafeActionLabel),
        description: t(sk.qrDescUnsafeAction),
        type: "boolean",
        currentValue: settings.unsafeAction.enabled,
      })
      .set("unsafeAction.channelId", {
        name: t(sk.qrUnsafeChannel),
        description: t(sk.qrDescUnsafeChannel),
        type: "select",
        selectType: ComponentType.ChannelSelect,
        currentValue: settings.unsafeAction.channelId ?? undefined,
      })
      .set("unsafeAction.deleteMessage", {
        name: t(sk.qrDeleteOnUnsafe),
        description: t(sk.qrDescDeleteOnUnsafe),
        type: "boolean",
        currentValue: settings.unsafeAction.deleteMessage,
      });

    if (settings.mode === "allowlist") {
      validFields.set("defaultAllowlistEnabled", {
        name: t(sk.qrDefaultAllowlist),
        description: t(sk.qrDescDefaultAllowlist),
        type: "boolean",
        currentValue: settings.defaultAllowlistEnabled,
      });
    }

    void this.createSettingsMenu(guildId, interaction, validFields);
  }

  private createSettingEmbed(
    name: string,
    description: string,
    t: TFunction,
    currentValue?: string,
  ) {
    const current = t(LanguageKeys.Settings.Current);

    if (currentValue === "true" || currentValue === "false")
      currentValue = getBoolean(t, currentValue === "true");

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(name)
      .setDescription(description);

    if (currentValue) embed.addField(current, currentValue);

    return embed;
  }

  private async createSettingsMenu(
    guildId: string,
    interaction: Command.ChatInputCommandInteraction,
    validFields: Map<string, QrSettingData>,
  ) {
    const t = await fetchT(interaction);
    this.menuId = nanoid();
    const menu = new ComponentUtils.MenuPaginatedMessage({ cache: false });

    for (const [settingKey, setting] of validFields) {
      let action: PaginatedMessageAction;
      let currentValue = setting.currentValue;

      if (setting.type === "select") {
        if (setting.selectType === ComponentType.ChannelSelect) {
          currentValue = currentValue
            ? this.makeIdReadable(currentValue as string, "channel")
            : currentValue;
          action = this.createChannelSelectMenu(
            settingKey,
            guildId,
            menu,
            setting.currentValue
              ? { id: setting.currentValue, type: SelectMenuDefaultValueType.Channel }
              : undefined,
            setting,
          );
        } else {
          const stringSetting = setting as Extract<QrSettingData, { type: "select"; selectType?: ComponentType.StringSelect }>;
          action = this.createStringSelectMenu(
            settingKey,
            guildId,
            stringSetting.options,
            menu,
            setting,
          );
        }
      } else {
        action = this.createBooleanButton(
          settingKey,
          guildId,
          menu,
          currentValue as boolean,
          undefined,
          setting,
        );
      }

      menu.addAsyncPageEmbed(async () => {
        const updated = await this.container.redis.jsonGet(guildId, "QrScanner");
        if (!updated) return this.createSettingEmbed(setting.name, setting.description, t);
        let updatedValue = this.getNestedValue(updated, settingKey);
        if (setting.type === "select" && setting.selectType === ComponentType.ChannelSelect) {
          updatedValue = updatedValue ? this.makeIdReadable(updatedValue as string, "channel") : updatedValue;
        }
        return this.createSettingEmbed(
          setting.name,
          setting.description,
          t,
          updatedValue?.toString() ?? currentValue?.toString(),
        );
      });
      menu.addPageAction(action, menu.pages.length - 1);
    }

    if (settings.mode === "blocklist") {
      this.addCustomListPage(menu, guildId, t, "blocklist");
    } else if (settings.mode === "allowlist") {
      this.addCustomListPage(menu, guildId, t, "allowlist");
    }

    void menu.run(interaction);
  }

  private addCustomListPage(
    menu: InstanceType<typeof ComponentUtils.MenuPaginatedMessage>,
    guildId: string,
    t: TFunction,
    mode: "allowlist" | "blocklist",
  ) {
    const sk = LanguageKeys.Commands.Moderation.SecuritySettings;
    const isBlocklist = mode === "blocklist";
    const listKey = isBlocklist ? "customBlocklist" : "customAllowlist";
    const labelKey = isBlocklist ? sk.qrCustomBlocklist : sk.qrCustomAllowlist;
    const descKey = isBlocklist ? sk.qrDescCustomBlocklist : sk.qrDescCustomAllowlist;

    menu.addAsyncPageEmbed(async () => {
      const settings = await this.container.redis.jsonGet(guildId, "QrScanner");
      const list = settings?.[listKey] ?? [];
      const entriesList = list.length > 0
        ? list.map((d, i) => `${i + 1}. \`${d}\``).join("\n")
        : t(sk.qrNoEntries);
      const count = t(sk.qrEntryCount, { count: list.length });

      return new EmbedUtils.EmbedConstructor()
        .setTitle(t(labelKey))
        .setDescription(`${t(descKey)}\n\n${count}\n\n${entriesList}`);
    });

    const addButton: PaginatedMessageActionButton = {
      customId: `${this.menuId}-qr-add-domain-${mode}`,
      style: ButtonStyle.Secondary,
      label: String(t(sk.qrAddEntry)),
      type: ComponentType.Button,
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isButton()) return null;

        const modalTitle = isBlocklist ? t(sk.qrAddDomainModalTitleBlocklist) : t(sk.qrAddDomainModalTitleAllowlist);
        const modal = new ModalBuilder()
          .setCustomId(`qr-add-domain-${mode}-${nanoid()}`)
          .setTitle(String(modalTitle))
          .setComponents(
            new ActionRowBuilder<TextInputBuilder>().setComponents(
              new TextInputBuilder()
                .setCustomId("domain")
                .setLabel(String(t(sk.qrModalDomainInput)))
                .setPlaceholder(String(t(sk.qrModalDomainPlaceholder)))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(253),
            ),
          );

        await interaction.showModal(modal);
        const modalResult = await interaction.awaitModalSubmit({
          time: 600_000,
          filter: (i) => i.user.id === interaction.user.id,
        }).catch(() => null);

        if (!modalResult) return null;

        const rawDomain = modalResult.fields.getTextInputValue("domain").trim();
        const normalized = this.normalizeDomainInput(rawDomain);

        if (!normalized) {
          await modalResult.reply({ content: t(sk.qrInvalidDomain), flags: MessageFlags.Ephemeral });
          return null;
        }

        const settings = await this.container.redis.jsonGet(guildId, "QrScanner");
        if (!settings) return null;

        const list = settings[listKey];
        if (list.length >= 25) {
          await modalResult.reply({ content: t(sk.qrMaxEntriesReached), flags: MessageFlags.Ephemeral });
          return null;
        }

        if (list.includes(normalized)) {
          await modalResult.reply({ content: t(sk.qrDuplicateDomain), flags: MessageFlags.Ephemeral });
          return null;
        }

        list.push(normalized);
        await this.container.redis.jsonSet(guildId, "QrScanner", settings);
        await modalResult.deferUpdate();

        return null as any;
      },
    };
    menu.addPageAction(addButton, menu.pages.length - 1);

    const removeButton: PaginatedMessageActionButton = {
      customId: `${this.menuId}-qr-remove-domain-${mode}`,
      style: ButtonStyle.Danger,
      label: String(t(sk.qrRemoveEntry)),
      type: ComponentType.Button,
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isButton()) return null;

        const settings = await this.container.redis.jsonGet(guildId, "QrScanner");
        if (!settings) return null;

        const list = settings[listKey];
        if (list.length === 0) return null;

        const options = list.map((d, i) => ({
          label: d.length > 80 ? `${d.slice(0, 77)}...` : d,
          value: String(i),
        }));

        const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${this.menuId}-qr-remove-select-${mode}`)
            .setPlaceholder(String(t(sk.qrSelectEntryToRemove)))
            .addOptions(options),
        );

        await interaction.update({ components: [...interaction.message.components, selectRow] });

        const selectInteraction = await interaction.channel?.awaitMessageComponent({
          filter: (i) => i.customId === `${this.menuId}-qr-remove-select-${mode}` && i.user.id === interaction.user.id,
          time: 60_000,
        }).catch(() => null);

        if (!selectInteraction || !selectInteraction.isStringSelectMenu()) return null;

        const index = parseInt(selectInteraction.values[0], 10);
        list.splice(index, 1);
        await this.container.redis.jsonSet(guildId, "QrScanner", settings);
        await selectInteraction.deferUpdate();

        return null as any;
      },
    };
    menu.addPageAction(removeButton, menu.pages.length - 1);
  }

  private normalizeDomainInput(input: string): string | null {
    let domain = input.toLowerCase().trim();
    if (!domain) return null;

    if (domain.startsWith("http://") || domain.startsWith("https://")) {
      try {
        const url = new URL(domain);
        domain = url.hostname;
      } catch {
        return null;
      }
    }

    if (domain.includes("/") || domain.includes(" ") || domain.includes(":")) {
      try {
        const url = new URL(`https://${domain}`);
        domain = url.hostname;
      } catch {
        return null;
      }
    }

    if (domain.startsWith("www.")) domain = domain.slice(4);

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
      return null;
    }

    return domain;
  }

  private getNestedValue(settings: QrScannerSettings, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = settings;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private async setNestedValue(
    guildId: string,
    path: string,
    value: unknown,
  ): Promise<QrScannerSettings | null> {
    const settings = await this.container.redis.jsonGet(guildId, "QrScanner");
    if (!settings) return null;

    const parts = path.split(".");
    const updated = { ...settings };
    let current: Record<string, unknown> = updated;
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = { ...(current[parts[i]] as Record<string, unknown> ?? {}) };
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;

    const parsed = QrScanner.safeParse(updated);
    if (!parsed.success) return null;

    await this.container.redis.jsonSet(guildId, "QrScanner", parsed.data);
    return parsed.data;
  }

  private createStringSelectMenu(
    name: string,
    guildId: string,
    options: SelectMenuComponentOptionData[],
    menu: InstanceType<typeof ComponentUtils.MenuPaginatedMessage>,
    field: QrSettingData,
  ): PaginatedMessageActionStringMenu {
    options.splice(25);

    return {
      type: ComponentType.StringSelect,
      customId: `${this.menuId}-${name}`,
      options,
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isStringSelectMenu())
          throw new UserError({ identifier: "genericError", message: "Incorrect menu type" });
        const optionValue = interaction.values[0];
        await this.setNestedValue(guildId, name, optionValue);

        const newComponents = interaction.message.components as (
          | ActionRow<StringSelectMenuComponent>
          | JSONEncodable<APIActionRowComponent<APIStringSelectComponent>>
        )[];
        newComponents.pop();
        newComponents.push(
          new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(
            new StringSelectMenuBuilder(
              this.createStringSelectMenu(
                name,
                guildId,
                options.map((o) => ({ ...o, default: o.value === optionValue })),
                menu,
                field,
              ),
            ),
          ),
        );

        menu.setPageActions(
          newComponents.map((c) => c.toJSON().components).flat().map((c) => {
            if (!("custom_id" in c)) return null;
            const action = menu.pageActions.at(menu.index)?.get(c.custom_id);
            if (action?.type !== ComponentType.StringSelect) return null;
            action.options = c.options;
            return action;
          }).filter((a) => a !== null),
          menu.index,
        );

        return {
          embeds: [this.confirmSettingChange(interaction, optionValue)],
          components: newComponents,
          ephemeral: true,
          edit: true,
        };
      },
    };
  }

  private createBooleanButton(
    name: string,
    guildId: string,
    menu: InstanceType<typeof ComponentUtils.MenuPaginatedMessage>,
    currentState: boolean,
    data?: Partial<Omit<InteractionButtonComponentData, "customId">>,
    field?: QrSettingData,
  ): PaginatedMessageActionButton {
    const options: InteractionButtonComponentData = {
      customId: `${this.menuId}-${name}`,
      style: currentState ? ButtonStyle.Success : ButtonStyle.Secondary,
      label: "Toggle",
      type: ComponentType.Button,
      ...data,
    };

    return {
      ...options,
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isButton())
          throw new UserError({ identifier: "genericError", message: "Incorrect menu type" });
        await interaction.deferUpdate();
        const optionValue = interaction.component.style !== ButtonStyle.Success;
        await this.setNestedValue(guildId, name, optionValue);

        const newComponents = interaction.message.components as (
          | ActionRow<ButtonComponent | StringSelectMenuComponent>
          | JSONEncodable<APIActionRowComponent<APIButtonComponentWithCustomId | APIStringSelectComponent>>
        )[];
        newComponents.pop();
        newComponents.push(
          new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder(
              this.createBooleanButton(name, guildId, menu, optionValue, data, field),
            ),
          ) as JSONEncodable<APIActionRowComponent<APIButtonComponentWithCustomId>>,
        );

        menu.setPageActions(
          newComponents.map((c) => c.toJSON().components).flat().map((c) => {
            if (!("custom_id" in c)) return null;
            return menu.pageActions.at(menu.index)?.get(c.custom_id) ?? null;
          }).filter((a) => a !== null),
          menu.index,
        );

        return {
          embeds: [this.confirmSettingChange(interaction, String(optionValue))],
          components: newComponents,
          ephemeral: true,
          edit: true,
        };
      },
    };
  }

  private createChannelSelectMenu(
    name: string,
    guildId: string,
    menu: InstanceType<typeof ComponentUtils.MenuPaginatedMessage>,
    defaultValue?: { id: string; type: SelectMenuDefaultValueType.Channel },
    field?: QrSettingData,
  ): PaginatedMessageActionChannelMenu {
    return {
      type: ComponentType.ChannelSelect,
      customId: `${this.menuId}-${name}`,
      minValues: 1,
      maxValues: 1,
      defaultValues: defaultValue ? [defaultValue] : undefined,
      channelTypes: [ChannelType.GuildText],
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isChannelSelectMenu())
          throw new UserError({ identifier: "genericError", message: "Incorrect menu type" });
        await interaction.deferUpdate();
        const optionValue = interaction.values[0];
        await this.setNestedValue(guildId, name, optionValue);

        const newComponents = interaction.message.components as (
          | ActionRow<ChannelSelectMenuComponent | StringSelectMenuComponent>
          | JSONEncodable<APIActionRowComponent<APIChannelSelectComponent | APIStringSelectComponent>>
        )[];
        newComponents.pop();
        newComponents.push(
          new ActionRowBuilder<ChannelSelectMenuBuilder>().setComponents(
            new ChannelSelectMenuBuilder(
              this.createChannelSelectMenu(
                name,
                guildId,
                menu,
                { id: optionValue, type: SelectMenuDefaultValueType.Channel },
                field,
              ),
            ),
          ),
        );

        menu.setPageActions(
          newComponents.map((c) => c.toJSON().components).flat().map((c) => {
            const action = menu.pageActions.at(menu.index)?.get(c.custom_id);
            if (action?.type !== ComponentType.StringSelect && action?.type !== ComponentType.ChannelSelect)
              return null;
            if (action.type === ComponentType.ChannelSelect) {
              c = c as APIChannelSelectComponent;
              action.channelTypes = c.channel_types;
              action.defaultValues = c.default_values;
            }
            action.disabled = c.disabled;
            action.placeholder = c.placeholder;
            action.minValues = c.min_values;
            action.maxValues = c.max_values;
            return action;
          }).filter((a) => a !== null),
          menu.index,
        );

        return {
          embeds: [this.confirmSettingChange(interaction, this.makeIdReadable(optionValue, "channel"))],
          components: newComponents,
          ephemeral: true,
          edit: true,
        };
      },
    };
  }

  private confirmSettingChange(
    interaction: ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction,
    value: string,
  ) {
    const embedData = interaction.message.embeds[0]?.toJSON() as EmbedData;
    const embed = new EmbedUtils.EmbedConstructor(embedData);
    embed.setColor(Colors.Success);

    const fields = interaction.message.embeds[0].fields;
    if (fields.length > 0) {
      const lastField = fields[fields.length - 1];
      lastField.value = value;
      embed.setFields([...fields.slice(0, fields.length - 1), lastField]);
    }

    setTimeout(() => {
      void interaction.editReply({ embeds: [embed.setColor(Colors.Default)] });
    }, REVERSE_COLOR_TIME);

    return embed;
  }

  private makeIdReadable(id: string, type: "user" | "channel" | "role") {
    if (type === "user") return `<@${id}>`;
    if (type === "channel") return `<#${id}>`;
    return `<@&${id}>`;
  }
}
