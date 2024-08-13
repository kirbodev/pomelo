import {
  Events,
  Listener,
  type MessageCommandDeniedPayload,
  UserError,
} from "@sapphire/framework";
import handler from "../../handlers/commandDeniedHandler.js";

export class MessageCommandDenied extends Listener<
  typeof Events.MessageCommandDenied
> {
  public run(error: UserError, payload: MessageCommandDeniedPayload) {
    void handler(error, payload);
  }
}
