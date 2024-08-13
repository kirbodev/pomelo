import {
  type ContextMenuCommandErrorPayload,
  Events,
  Listener,
  UserError,
} from "@sapphire/framework";
import handler from "../../handlers/commandDeniedHandler.js";

export class ContextMenuCommandDenied extends Listener<
  typeof Events.ContextMenuCommandError
> {
  public run(error: UserError, payload: ContextMenuCommandErrorPayload) {
    void handler(error, payload);
  }
}
