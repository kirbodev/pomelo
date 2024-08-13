import {
  isMessageButtonInteractionData,
  isMessageChannelSelectInteractionData,
  isMessageMentionableSelectInteractionData,
  isMessageRoleSelectInteractionData,
  isMessageStringSelectInteractionData,
  isMessageUserSelectInteractionData,
  PaginatedMessage,
  type PaginatedMessageAction,
  type PaginatedMessageActionStringMenu,
  type PaginatedMessageOptions,
  type PaginatedMessageResolvedPage,
  type PaginatedMessageWrongUserInteractionReplyFunction,
} from "@sapphire/discord.js-utilities";
import { container, type Command } from "@sapphire/framework";
import { Utility } from "@sapphire/plugin-utilities-store";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonComponent,
  ButtonInteraction,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuComponent,
  ComponentType,
  EmbedBuilder,
  MentionableSelectMenuBuilder,
  MentionableSelectMenuComponent,
  Message,
  RoleSelectMenuBuilder,
  RoleSelectMenuComponent,
  StringSelectMenuBuilder,
  StringSelectMenuComponent,
  User,
  UserSelectMenuBuilder,
  UserSelectMenuComponent,
  type InteractionReplyOptions,
  type MessageActionRowComponentBuilder,
  type MessageReplyOptions,
  type SelectMenuComponentOptionData,
} from "discord.js";
import { nanoid } from "nanoid";
import { fetchT } from "../lib/i18n/utils.js";
import EmbedUtils from "./embedUtils.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { Colors } from "../lib/colors.js";

export type ButtonConfirmationButtonOptions = {
  text: string;
  style: ButtonStyle;
};

export type ButtonConfirmationOptions = {
  timeout: number;
  buttons: {
    confirm: ButtonConfirmationButtonOptions;
    cancel: ButtonConfirmationButtonOptions;
  };
};

type PrivateButtonConfirmationButtonOptions =
  ButtonConfirmationButtonOptions & {
    customId?: string;
  };

type PrivateButtonConfirmationOptions = ButtonConfirmationOptions & {
  buttons: {
    confirm: PrivateButtonConfirmationButtonOptions;
    cancel: PrivateButtonConfirmationButtonOptions;
  };
};

const defaults: ButtonConfirmationOptions = {
  timeout: 1000 * 60 * 10,
  buttons: {
    confirm: {
      text: "✅",
      style: ButtonStyle.Success,
    },
    cancel: {
      text: "❌",
      style: ButtonStyle.Danger,
    },
  },
};

export default class ComponentUtils extends Utility {
  public constructor(context: Utility.LoaderContext, options: Utility.Options) {
    super(context, {
      ...options,
      name: "componentUtils",
    });
  }

  public async disableButtons(msg: Message) {
    const updatedComponents = msg.components.map((row) => {
      return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        row.components.map((component) => {
          if (component instanceof ButtonComponent)
            return ButtonBuilder.from(component).setDisabled(true);
          if (component instanceof StringSelectMenuComponent)
            return StringSelectMenuBuilder.from(component).setDisabled(true);
          if (component instanceof RoleSelectMenuComponent)
            return RoleSelectMenuBuilder.from(component).setDisabled(true);
          if (component instanceof UserSelectMenuComponent)
            return UserSelectMenuBuilder.from(component).setDisabled(true);
          if (component instanceof ChannelSelectMenuComponent)
            return ChannelSelectMenuBuilder.from(component).setDisabled(true);
          if (component instanceof MentionableSelectMenuComponent)
            return MentionableSelectMenuBuilder.from(component).setDisabled(
              true
            );
        }) as unknown as MessageActionRowComponentBuilder[]
      );
    });
    try {
      return await msg.edit({ components: updatedComponents });
    } catch {
      return null;
    }
  }

  static ButtonConfirmationConstructor = class ButtonConfirmationConstructor extends ActionRowBuilder<ButtonBuilder> {
    private options: PrivateButtonConfirmationOptions;

    public constructor(options?: Partial<ButtonConfirmationOptions>) {
      super();
      this.options = {
        ...defaults,
        ...options,
      };
      this.options.buttons.confirm.customId = nanoid();
      this.options.buttons.cancel.customId = nanoid();
      this.addComponents(this.constructButtons());
    }

    public async waitForResponse(
      interaction:
        | Message
        | Command.ChatInputCommandInteraction
        | Command.ContextMenuCommandInteraction,
      sendOptions?:
        | Omit<MessageReplyOptions, "components">
        | Omit<InteractionReplyOptions, "components">
    ): Promise<{
      response: boolean;
      interaction: ButtonInteraction | null;
    }> {
      const res = await new Promise<{
        response: boolean;
        interaction: ButtonInteraction | null;
        reply: Promise<Message> | null;
      }>((resolve) => {
        if (!interaction.channel) {
          throw new Error("Interaction must be in a text channel");
        }
        let reply: Promise<Message> | null = null;
        if (interaction instanceof Message) {
          reply = interaction.reply({
            ...(sendOptions as MessageReplyOptions),
            components: [this],
          });

          reply.catch(() => {
            resolve({ response: false, interaction: null, reply: null });
          });
        } else {
          reply = interaction
            .reply({
              ...(sendOptions as InteractionReplyOptions),
              components: [this],
            })
            .then((r) => r.fetch());

          reply.catch(() => {
            resolve({ response: false, interaction: null, reply: null });
          });
        }
        void interaction.channel
          .awaitMessageComponent({
            filter: (i) =>
              i.customId === this.options.buttons.confirm.customId ||
              i.customId === this.options.buttons.cancel.customId,
            time: this.options.timeout,
            componentType: ComponentType.Button,
          })
          .then((i) => {
            resolve({
              response: i.customId === this.options.buttons.confirm.customId,
              interaction: i,
              reply,
            });
          });
      })
        .catch(() => {
          return {
            response: false,
            interaction: null,
            reply: null,
          };
        })
        .then((i) => {
          if (i.reply)
            i.reply
              .then(
                (r) => void container.utilities.componentUtils.disableButtons(r)
              )
              .catch(() => null);
          return i;
        });
      return res;
    }

    private constructButtons() {
      const { confirm, cancel } = this.options.buttons as {
        confirm: Required<PrivateButtonConfirmationButtonOptions>;
        cancel: Required<PrivateButtonConfirmationButtonOptions>;
      };
      const confirmButton = new ButtonBuilder()
        .setCustomId(confirm.customId)
        .setLabel(confirm.text)
        .setStyle(confirm.style);
      const cancelButton = new ButtonBuilder()
        .setCustomId(cancel.customId)
        .setLabel(cancel.text)
        .setStyle(cancel.style);
      return [confirmButton, cancelButton];
    }
  };

  static PomeloPaginatedMessage = class PomeloPaginatedMessage extends PaginatedMessage {
    public constructor(data?: PaginatedMessageOptions) {
      super(data);
    }

    protected wrongUserInteractionReply: PaginatedMessageWrongUserInteractionReplyFunction =
      (target: User, user: User) => {
        const t = fetchT(user.id);
        return {
          embeds: [
            new EmbedUtils.EmbedConstructor()
              .setTitle(t(LanguageKeys.Errors.WrongTarget.title))
              .setDescription(
                t(LanguageKeys.Errors.WrongTarget.desc_detailed, {
                  target: target.username,
                })
              )
              .setColor(Colors.Error),
          ],
          ephemeral: true,
        };
      };
  };

  static MenuPaginatedMessage = class MenuPaginatedMessage extends ComponentUtils.PomeloPaginatedMessage {
    public constructor(data?: PaginatedMessageOptions) {
      super(data);
      // const selector = PaginatedMessage.defaultActions.find(
      //   (action) => action.type === ComponentType.StringSelect
      // );
      // if (!selector) return;
      // super.setActions([this.getMenuAction()], false);
    }

    protected override handleActionLoad(
      actions: PaginatedMessageAction[]
    ): Promise<MessageActionRowComponentBuilder[]> {
      return Promise.all(
        actions.map<Promise<MessageActionRowComponentBuilder>>(
          async (interaction) => {
            if (isMessageButtonInteractionData(interaction)) {
              return new ButtonBuilder(interaction);
            }

            if (isMessageUserSelectInteractionData(interaction)) {
              return new UserSelectMenuBuilder(interaction);
            }

            if (isMessageRoleSelectInteractionData(interaction)) {
              return new RoleSelectMenuBuilder(interaction);
            }

            if (isMessageMentionableSelectInteractionData(interaction)) {
              return new MentionableSelectMenuBuilder(interaction);
            }

            if (isMessageChannelSelectInteractionData(interaction)) {
              return new ChannelSelectMenuBuilder(interaction);
            }

            if (isMessageStringSelectInteractionData(interaction)) {
              return new StringSelectMenuBuilder({
                ...interaction,
                ...(interaction.customId ===
                  "@sapphire/paginated-messages.goToPage" && {
                  options: await Promise.all(
                    this.pages.map((_page, index) => {
                      const page = _page instanceof Function ? null : _page;
                      const embed = EmbedBuilder.from(
                        page?.embeds?.[0] ?? new EmbedBuilder()
                      );

                      return {
                        label:
                          embed.data.title ?? `Menu Item ${index.toString()}`,
                        value: index.toString(),
                      };
                    })
                  ),
                  placeholder: this.selectMenuPlaceholder,
                }),
              });
            }

            throw new Error("Unsupported message component type detected.");
          }
        )
      );
    }

    public getMenuAction(): PaginatedMessageActionStringMenu {
      return {
        type: ComponentType.StringSelect,
        customId: "menu_select",
        options: this.messages
          .map((m, i) => {
            if (!m) return null;
            const title = this.getEmbedTitle(m) ?? `Menu Item ${i.toString()}`;
            return {
              label: title,
              value: i.toString(),
            } satisfies SelectMenuComponentOptionData;
          })
          .filter((o): o is SelectMenuComponentOptionData => o !== null),
        run({ handler, interaction }) {
          if (interaction.componentType !== ComponentType.StringSelect) return;
          const index = parseInt(interaction.values[0]);
          handler.setIndex(index);
        },
      };
    }

    private getEmbedTitle(
      message: PaginatedMessageResolvedPage
    ): string | null {
      if (!message.embeds?.[0]) return null;
      return EmbedBuilder.from(message.embeds[0]).data.title ?? null;
    }
  };
}

declare module "@sapphire/plugin-utilities-store" {
  export interface Utilities {
    componentUtils: ComponentUtils;
  }
}
