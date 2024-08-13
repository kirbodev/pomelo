import {
  Events,
  Listener,
  type MessageCommandErrorPayload,
  UserError,
} from "@sapphire/framework";
import handler from "../../handlers/commandDeniedHandler.js";

export class MessageCommandError extends Listener<
  typeof Events.MessageCommandError
> {
  public run(error: UserError, payload: MessageCommandErrorPayload) {
    void handler(error, payload);
  }
}
