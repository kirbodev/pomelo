import {
  type ContextMenuCommandDeniedPayload,
  Events,
  Listener,
  UserError,
} from "@sapphire/framework";
import handler from "../../handlers/commandDeniedHandler.js";

export class ContextMenuCommandDenied extends Listener<
  typeof Events.ContextMenuCommandDenied
> {
  public run(error: UserError, payload: ContextMenuCommandDeniedPayload) {
    void handler(error, payload);
  }
}
