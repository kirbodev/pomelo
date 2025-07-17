import { T, type CapitalizedObjectKeys } from "../types/utils.js";
import messages from "../../languages/en-US/messages.json" with { type: "json" };

export default {
    AfkAutoModChanged: {
        title: T("messages:afkAutoModChanged.title"),
        desc: T("messages:afkAutoModChanged.desc"),
    },
    Onboarding: {
        title: T("messages:onboarding.title"),
        desc: T("messages:onboarding.desc"),
    }
} as CapitalizedObjectKeys<typeof messages>;