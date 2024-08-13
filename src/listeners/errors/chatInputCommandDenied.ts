import {
  type ChatInputCommandDeniedPayload,
  Events,
  Listener,
  UserError,
} from "@sapphire/framework";
import handler from "../../handlers/commandDeniedHandler.js";

export class ChatInputCommandDenied extends Listener<
  typeof Events.ChatInputCommandDenied
> {
  public run(error: UserError, payload: ChatInputCommandDeniedPayload) {
    void handler(error, payload);
  }
}
