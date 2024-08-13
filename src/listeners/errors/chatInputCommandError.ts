import {
  type ChatInputCommandErrorPayload,
  Events,
  Listener,
  UserError,
} from "@sapphire/framework";
import handler from "../../handlers/commandDeniedHandler.js";

export class ChatInputCommandDenied extends Listener<
  typeof Events.ChatInputCommandError
> {
  public run(error: UserError, payload: ChatInputCommandErrorPayload) {
    void handler(error, payload);
  }
}
