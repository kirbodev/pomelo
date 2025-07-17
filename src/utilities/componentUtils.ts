import {
  actionIsButtonOrMenu,
  isMessageButtonInteractionData,
  isMessageChannelSelectInteractionData,
  isMessageMentionableSelectInteractionData,
  isMessageRoleSelectInteractionData,
  isMessageStringSelectInteractionData,
  isMessageUserSelectInteractionData,
  PaginatedMessage,
  safelyReplyToInteraction,
  type AnyInteractableInteraction,
  type PaginatedMessageAction,
  type PaginatedMessageActionContext,
  type PaginatedMessageComponentUnion,
  type PaginatedMessageInteractionUnion,
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
  MessageFlags,
  RoleSelectMenuBuilder,
  RoleSelectMenuComponent,
  StringSelectMenuBuilder,
  StringSelectMenuComponent,
  User,
  UserSelectMenuBuilder,
  UserSelectMenuComponent,
  type ButtonComponentData,
  type InteractionButtonComponentData,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageActionRowComponentBuilder,
  type MessageReplyOptions,
} from "discord.js";
import { nanoid } from "nanoid";
import { fetchT } from "../lib/i18n/utils.js";
import EmbedUtils from "./embedUtils.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { Colors } from "../lib/colors.js";
import { isNullish, isObject, type Awaitable } from "@sapphire/utilities";
import { createPartitionedMessageRow } from "@sapphire/discord.js-utilities";
import { PomeloReplyType } from "./commandUtils.js";

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

type PomeloPaginatedMessageOptions = PaginatedMessageOptions & {
  cache?: boolean;
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
      if (row.type !== ComponentType.ActionRow) return row;
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

  static EphemeralButton = class EphemeralButton extends ButtonBuilder {
    customId: string;

    public constructor(rawData?: InteractionButtonComponentData) {
      const customId = nanoid();
      const defaults: Partial<ButtonComponentData> = {
        style: ButtonStyle.Secondary,
        emoji: "👁️",
        type: ComponentType.Button,
      };
      const data = {
        ...defaults,
        ...rawData,
        customId,
      };
      super(data);

      this.customId = customId;
    }

    public async waitForResponse(
      interaction: AnyInteractableInteraction | Message,
      timeout = 1000 * 60 * 10
    ) {
      const i = await interaction.channel
        ?.awaitMessageComponent({
          filter: (i) => i.customId === this.customId,
          time: timeout,
          componentType: ComponentType.Button,
        })
        .catch(() => null);
      if (!i) return null;
      return await this.execute(i);
    }

    public async execute(interaction: ButtonInteraction) {
      const message = interaction.message;

      const filteredComponents = message.components
        .map((row) => {
          if (row.type !== ComponentType.ActionRow) return row;
          return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            row.components
              .map((component: unknown) => {
                if (
                  !(
                    component instanceof ButtonComponent &&
                    component.customId === this.customId
                  )
                )
                  return component;
              })
              .filter(
                (component: unknown) => component !== undefined
              ) as unknown as MessageActionRowComponentBuilder[]
          );
        })
        .filter(
          (row) =>
            "components" in row &&
            Array.isArray(row.components) &&
            row.components.length > 0
        );

      return await interaction
        .reply({
          content: message.content,
          embeds: message.embeds,
          components: filteredComponents,
          flags: MessageFlags.Ephemeral,
        })
        .catch((e: unknown) => {
          console.error(e);
        });
    }
  };

  static PomeloPaginatedMessage = class PomeloPaginatedMessage extends PaginatedMessage {
    #thisMazeWasNotMeantForYouContent = {
      content: "This maze wasn't meant for you...what did you do.",
    };
    public cache = true;

    public constructor(data?: PomeloPaginatedMessageOptions) {
      super(data);
      this.cache = data?.cache ?? true;
    }

    protected wrongUserInteractionReply: PaginatedMessageWrongUserInteractionReplyFunction =
      async (target: User, user: User) => {
        const t = await fetchT(user.id);
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
          flags: MessageFlags.Ephemeral,
        };
      };

    private _getAction(
      customId: string,
      index: number
    ): PaginatedMessageAction | undefined {
      const action = this.actions.get(customId);
      if (action) return action;
      return this.pageActions.at(index)?.get(customId);
    }

    protected override async handleCollect(
      targetUser: User,
      channel: Message["channel"],
      interaction: PaginatedMessageInteractionUnion
    ): Promise<void> {
      if (interaction.user.id === targetUser.id) {
        // Update the response to the latest interaction
        this.response = interaction;

        const action = this._getAction(interaction.customId, this.index);
        if (isNullish(action)) {
          throw new Error("There was no action for the provided custom ID");
        }

        if (!this.collector) {
          throw new Error("No collector was found");
        }

        if (actionIsButtonOrMenu(action) && action.run) {
          const previousIndex = this.index;

          const resp = await action.run({
            interaction,
            handler: this,
            author: targetUser,
            channel,
            response: this.response,
            collector: this.collector,
          });

          if (!this.stopPaginatedMessageCustomIds.includes(action.customId)) {
            const newIndex =
              previousIndex === this.index ? previousIndex : this.index;

            const updateOptions = await this.resolvePage(
              this.response,
              targetUser,
              newIndex
            );

            // If the response is null, don't do anything
            if (resp === null) return;
            if (isObject(resp)) {
              if (resp.edit) {
                interaction.replied || interaction.deferred
                  ? await interaction.editReply(resp)
                  : await interaction.update(resp);
              } else {
                await container.utilities.commandUtils.reply(
                  interaction,
                  resp,
                  {
                    type: PomeloReplyType.Error,
                  }
                );
              }
            } else {
              await safelyReplyToInteraction({
                messageOrInteraction: interaction,
                interactionEditReplyContent: updateOptions,
                interactionReplyContent: {
                  ...this.#thisMazeWasNotMeantForYouContent,
                  flags: MessageFlags.Ephemeral,
                },
                componentUpdateContent: updateOptions,
              });
            }
          }
        }
      } else {
        const interactionReplyOptions = await this.wrongUserInteractionReply(
          targetUser,
          interaction.user,
          this.resolvePaginatedMessageInternationalizationContext(
            interaction,
            targetUser
          )
        );

        await interaction.reply(
          isObject(interactionReplyOptions)
            ? interactionReplyOptions
            : {
                content: interactionReplyOptions,
                flags: MessageFlags.Ephemeral,
                allowedMentions: { users: [], roles: [] },
              }
        );
      }
    }

    public async resolvePage(
      messageOrInteraction: Message | AnyInteractableInteraction,
      target: User,
      index: number
    ): Promise<PaginatedMessageResolvedPage> {
      // If the message was already processed, do not load it again IF the cache is enabled:
      const message = this.messages[index];
      if (!isNullish(message) && this.cache) {
        return message;
      }

      // Load the page and return it:
      const resolvedPage = await this.handlePageLoad(this.pages[index], index);
      if (resolvedPage.actions) {
        this.addPageActions(resolvedPage.actions, index);
      }

      const pageSpecificActions = this.pageActions.at(index);
      const resolvedComponents: PaginatedMessageComponentUnion[] = [];

      if (this.pages.length > 1) {
        const sharedActions = await this.handleActionLoad(
          [...this.actions.values()],
          messageOrInteraction,
          target
        );
        const sharedComponents = createPartitionedMessageRow(sharedActions);

        resolvedComponents.push(...sharedComponents);
      }

      if (pageSpecificActions) {
        const pageActions = await this.handleActionLoad(
          [...pageSpecificActions.values()],
          messageOrInteraction,
          target
        );
        const pageComponents = createPartitionedMessageRow(pageActions);

        resolvedComponents.push(...pageComponents);
      }

      const resolved = { ...resolvedPage, components: resolvedComponents };
      this.messages[index] = resolved;

      return resolved;
    }
  };

  static MenuPaginatedMessage = class MenuPaginatedMessage extends ComponentUtils.PomeloPaginatedMessage {
    public constructor(data?: PomeloPaginatedMessageOptions) {
      super(data);
      super.setActions(
        PaginatedMessage.defaultActions.filter(
          (action) => action.type === ComponentType.StringSelect
        ),
        false
      );
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
                    this.pages.map(async (_page, index) => {
                      const page =
                        _page instanceof Function
                          ? await _page(index, this.pages, this)
                          : _page;
                      const embed = EmbedBuilder.from(
                        page.embeds?.[0] ?? new EmbedBuilder()
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
  };
}

declare module "@sapphire/plugin-utilities-store" {
  export interface Utilities {
    componentUtils: ComponentUtils;
  }
}

declare module "@sapphire/discord.js-utilities" {
  export interface PaginatedMessageActionRun {
    run?(
      context: PaginatedMessageActionContext
    ): Awaitable<
      | (InteractionReplyOptions & { edit?: false })
      | (InteractionEditReplyOptions & { edit: true })
      | null
    >;
  }
}
