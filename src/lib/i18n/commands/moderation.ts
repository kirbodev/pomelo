import { FT, T, type CapitalizedObjectKeys } from "../../types/utils.js";
import moderation from "../../../languages/en-US/commands/moderation.json" with { type: "json" };

export default {
  Kick: {
    commandName: T("commands/moderation:kick.commandName"),
    commandDescription: T("commands/moderation:kick.commandDescription"),
    userFieldName: T("commands/moderation:kick.userFieldName"),
    userFieldDescription: T("commands/moderation:kick.userFieldDescription"),
    reasonFieldName: T("commands/moderation:kick.reasonFieldName"),
    reasonFieldDescription: T(
      "commands/moderation:kick.reasonFieldDescription",
    ),
    title: T("commands/moderation:kick.title"),
    desc: FT<{ user: string }>("commands/moderation:kick.desc"),
    descWithReason: FT<{ user: string; reason: string }>(
      "commands/moderation:kick.descWithReason",
    ),
    dmSent: T("commands/moderation:kick.dmSent"),
    dmNotSent: T("commands/moderation:kick.dmNotSent"),
  },
  Ban: {
    commandName: T("commands/moderation:ban.commandName"),
    commandDescription: T("commands/moderation:ban.commandDescription"),
    userFieldName: T("commands/moderation:ban.userFieldName"),
    userFieldDescription: T("commands/moderation:ban.userFieldDescription"),
    reasonFieldName: T("commands/moderation:ban.reasonFieldName"),
    reasonFieldDescription: T("commands/moderation:ban.reasonFieldDescription"),
    durationFieldName: T("commands/moderation:ban.durationFieldName"),
    durationFieldDescription: T(
      "commands/moderation:ban.durationFieldDescription",
    ),
    deleteMessagesFieldName: T(
      "commands/moderation:ban.deleteMessagesFieldName",
    ),
    deleteMessagesFieldDescription: T(
      "commands/moderation:ban.deleteMessagesFieldDescription",
    ),
    title: T("commands/moderation:ban.title"),
    desc: FT<{ user: string }>("commands/moderation:ban.desc"),
    descWithReason: FT<{ user: string; reason: string }>(
      "commands/moderation:ban.descWithReason",
    ),
    descTemp: FT<{ user: string; duration: string }>(
      "commands/moderation:ban.descTemp",
    ),
    dmSent: T("commands/moderation:ban.dmSent"),
    dmNotSent: T("commands/moderation:ban.dmNotSent"),
    deleteMessagesNone: T("commands/moderation:ban.deleteMessagesNone"),
    deleteMessages1h: T("commands/moderation:ban.deleteMessages1h"),
    deleteMessages6h: T("commands/moderation:ban.deleteMessages6h"),
    deleteMessages24h: T("commands/moderation:ban.deleteMessages24h"),
    deleteMessages3d: T("commands/moderation:ban.deleteMessages3d"),
    deleteMessages7d: T("commands/moderation:ban.deleteMessages7d"),
  },
  Unban: {
    commandName: T("commands/moderation:unban.commandName"),
    commandDescription: T("commands/moderation:unban.commandDescription"),
    userIdFieldName: T("commands/moderation:unban.userIdFieldName"),
    userIdFieldDescription: T(
      "commands/moderation:unban.userIdFieldDescription",
    ),
    reasonFieldName: T("commands/moderation:unban.reasonFieldName"),
    reasonFieldDescription: T(
      "commands/moderation:unban.reasonFieldDescription",
    ),
    title: T("commands/moderation:unban.title"),
    desc: FT<{ user: string }>("commands/moderation:unban.desc"),
    descWithReason: FT<{ user: string; reason: string }>(
      "commands/moderation:unban.descWithReason",
    ),
  },
  Mute: {
    commandName: T("commands/moderation:mute.commandName"),
    commandDescription: T("commands/moderation:mute.commandDescription"),
    userFieldName: T("commands/moderation:mute.userFieldName"),
    userFieldDescription: T("commands/moderation:mute.userFieldDescription"),
    durationFieldName: T("commands/moderation:mute.durationFieldName"),
    durationFieldDescription: T(
      "commands/moderation:mute.durationFieldDescription",
    ),
    reasonFieldName: T("commands/moderation:mute.reasonFieldName"),
    reasonFieldDescription: T(
      "commands/moderation:mute.reasonFieldDescription",
    ),
    title: T("commands/moderation:mute.title"),
    desc: FT<{ user: string; duration: string }>(
      "commands/moderation:mute.desc",
    ),
    descWithReason: FT<{ user: string; duration: string; reason: string }>(
      "commands/moderation:mute.descWithReason",
    ),
    dmSent: T("commands/moderation:mute.dmSent"),
    dmNotSent: T("commands/moderation:mute.dmNotSent"),
    durationTooLong: T("commands/moderation:mute.durationTooLong"),
  },
  Unmute: {
    commandName: T("commands/moderation:unmute.commandName"),
    commandDescription: T("commands/moderation:unmute.commandDescription"),
    userFieldName: T("commands/moderation:unmute.userFieldName"),
    userFieldDescription: T("commands/moderation:unmute.userFieldDescription"),
    reasonFieldName: T("commands/moderation:unmute.reasonFieldName"),
    reasonFieldDescription: T(
      "commands/moderation:unmute.reasonFieldDescription",
    ),
    title: T("commands/moderation:unmute.title"),
    desc: FT<{ user: string }>("commands/moderation:unmute.desc"),
    descWithReason: FT<{ user: string; reason: string }>(
      "commands/moderation:unmute.descWithReason",
    ),
  },
  Warn: {
    commandName: T("commands/moderation:warn.commandName"),
    commandDescription: T("commands/moderation:warn.commandDescription"),
    userFieldName: T("commands/moderation:warn.userFieldName"),
    userFieldDescription: T("commands/moderation:warn.userFieldDescription"),
    reasonFieldName: T("commands/moderation:warn.reasonFieldName"),
    reasonFieldDescription: T(
      "commands/moderation:warn.reasonFieldDescription",
    ),
    amountFieldName: T("commands/moderation:warn.amountFieldName"),
    amountFieldDescription: T(
      "commands/moderation:warn.amountFieldDescription",
    ),
    advancedFieldName: T("commands/moderation:warn.advancedFieldName"),
    advancedFieldDescription: T(
      "commands/moderation:warn.advancedFieldDescription",
    ),
    subcommandListName: T("commands/moderation:warn.subcommandListName"),
    subcommandListDescription: T(
      "commands/moderation:warn.subcommandListDescription",
    ),
    subcommandRemoveName: T("commands/moderation:warn.subcommandRemoveName"),
    subcommandRemoveDescription: T(
      "commands/moderation:warn.subcommandRemoveDescription",
    ),
    subcommandLevelName: T("commands/moderation:warn.subcommandLevelName"),
    subcommandLevelDescription: T(
      "commands/moderation:warn.subcommandLevelDescription",
    ),
    subcommandSetName: T("commands/moderation:warn.subcommandSetName"),
    subcommandSetDescription: T(
      "commands/moderation:warn.subcommandSetDescription",
    ),
    subcommandMultiName: T("commands/moderation:warn.subcommandMultiName"),
    subcommandMultiDescription: T(
      "commands/moderation:warn.subcommandMultiDescription",
    ),
    usersFieldName: T("commands/moderation:warn.usersFieldName"),
    usersFieldDescription: T("commands/moderation:warn.usersFieldDescription"),
    levelFieldName: T("commands/moderation:warn.levelFieldName"),
    levelFieldDescription: T("commands/moderation:warn.levelFieldDescription"),
    caseIdFieldName: T("commands/moderation:warn.caseIdFieldName"),
    caseIdFieldDescription: T(
      "commands/moderation:warn.caseIdFieldDescription",
    ),
    title: T("commands/moderation:warn.title"),
    desc: FT<{ user: string; amount: string }>("commands/moderation:warn.desc"),
    descWithReason: FT<{ user: string; reason: string; amount: string }>(
      "commands/moderation:warn.descWithReason",
    ),
    warnedCount: FT<{ count: number }>("commands/moderation:warn.warnedCount"),
    heavywarnCommandName: T("commands/moderation:warn.heavywarnCommandName"),
    heavywarnCommandDescription: T(
      "commands/moderation:warn.heavywarnCommandDescription",
    ),
    listTitle: FT<{ user: string }>("commands/moderation:warn.listTitle"),
    listEmpty: T("commands/moderation:warn.listEmpty"),
    listEntry: FT<{ id: string; reason: string; expiry: string }>(
      "commands/moderation:warn.listEntry",
    ),
  },
  WarnSettings: {
    commandName: T("commands/moderation:warnSettings.commandName"),
    commandDescription: T(
      "commands/moderation:warnSettings.commandDescription",
    ),
    subcommandActionsName: T(
      "commands/moderation:warnSettings.subcommandActionsName",
    ),
    subcommandActionsDescription: T(
      "commands/moderation:warnSettings.subcommandActionsDescription",
    ),
    subcommandRolesName: T(
      "commands/moderation:warnSettings.subcommandRolesName",
    ),
    subcommandRolesDescription: T(
      "commands/moderation:warnSettings.subcommandRolesDescription",
    ),
    subcommandPresetName: T(
      "commands/moderation:warnSettings.subcommandPresetName",
    ),
    subcommandPresetDescription: T(
      "commands/moderation:warnSettings.subcommandPresetDescription",
    ),
    quickstartCommandName: T(
      "commands/moderation:warnSettings.quickstartCommandName",
    ),
    quickstartCommandDescription: T(
      "commands/moderation:warnSettings.quickstartCommandDescription",
    ),
    viewTitle: T("commands/moderation:warnSettings.viewTitle"),
    expiry: T("commands/moderation:warnSettings.expiry"),
    dmOnWarn: T("commands/moderation:warnSettings.dmOnWarn"),
    actions: T("commands/moderation:warnSettings.actions"),
    noActions: T("commands/moderation:warnSettings.noActions"),
    expiryFieldName: T("commands/moderation:warnSettings.expiryFieldName"),
    expiryFieldDescription: T(
      "commands/moderation:warnSettings.expiryFieldDescription",
    ),
    dmFieldName: T("commands/moderation:warnSettings.dmFieldName"),
    dmFieldDescription: T(
      "commands/moderation:warnSettings.dmFieldDescription",
    ),
    dmEnabled: T("commands/moderation:warnSettings.dmEnabled"),
    dmDisabled: T("commands/moderation:warnSettings.dmDisabled"),
    logChannelFieldName: T(
      "commands/moderation:warnSettings.logChannelFieldName",
    ),
    logChannelFieldDescription: T(
      "commands/moderation:warnSettings.logChannelFieldDescription",
    ),
    presetLemomeme: T("commands/moderation:warnSettings.presetLemomeme"),
    presetRecommended: T("commands/moderation:warnSettings.presetRecommended"),
    presetProgressive: T("commands/moderation:warnSettings.presetProgressive"),
    presetStrictStrike: T(
      "commands/moderation:warnSettings.presetStrictStrike",
    ),
    updated: T("commands/moderation:warnSettings.updated"),
    viewEmpty: T("commands/moderation:warnSettings.viewEmpty"),
    viewActionsLabel: T("commands/moderation:warnSettings.viewActionsLabel"),
    viewMaxWarns: T("commands/moderation:warnSettings.viewMaxWarns"),
    viewLogChannel: T("commands/moderation:warnSettings.viewLogChannel"),
    viewEnabled: T("commands/moderation:warnSettings.viewEnabled"),
    viewDisabled: T("commands/moderation:warnSettings.viewDisabled"),
    actionsListTitle: T("commands/moderation:warnSettings.actionsListTitle"),
    actionsListEmpty: T("commands/moderation:warnSettings.actionsListEmpty"),
    actionsListLine: FT<{ count: number; action: string; duration: string }>(
      "commands/moderation:warnSettings.actionsListLine",
    ),
    actionsListDuration: T(
      "commands/moderation:warnSettings.actionsListDuration",
    ),
    presetPickerTitle: T("commands/moderation:warnSettings.presetPickerTitle"),
    presetPickerDescription: T(
      "commands/moderation:warnSettings.presetPickerDescription",
    ),
    presetPickerPlaceholder: T(
      "commands/moderation:warnSettings.presetPickerPlaceholder",
    ),
    roleConfigTitle: T("commands/moderation:warnSettings.roleConfigTitle"),
    roleConfigLabel: T("commands/moderation:warnSettings.roleConfigLabel"),
    roleConfigPlaceholder: T(
      "commands/moderation:warnSettings.roleConfigPlaceholder",
    ),
    roleConfigHelp: T("commands/moderation:warnSettings.roleConfigHelp"),
    roleConfigSaved: T("commands/moderation:warnSettings.roleConfigSaved"),
    yes: T("commands/moderation:warnSettings.yes"),
    no: T("commands/moderation:warnSettings.no"),
    notSet: T("commands/moderation:warnSettings.notSet"),
    Quickstart: {
      welcomeTitle: T(
        "commands/moderation:warnSettings.quickstart.welcomeTitle",
      ),
      welcomeDescription: T(
        "commands/moderation:warnSettings.quickstart.welcomeDescription",
      ),
      startFromPreset: T(
        "commands/moderation:warnSettings.quickstart.startFromPreset",
      ),
      buildFromScratch: T(
        "commands/moderation:warnSettings.quickstart.buildFromScratch",
      ),
      presetTitle: T("commands/moderation:warnSettings.quickstart.presetTitle"),
      presetDescription: T(
        "commands/moderation:warnSettings.quickstart.presetDescription",
      ),
      presetLemomeme: T(
        "commands/moderation:warnSettings.quickstart.presetLemomeme",
      ),
      presetLemomemeDesc: T(
        "commands/moderation:warnSettings.quickstart.presetLemomemeDesc",
      ),
      presetRecommended: T(
        "commands/moderation:warnSettings.quickstart.presetRecommended",
      ),
      presetRecommendedDesc: T(
        "commands/moderation:warnSettings.quickstart.presetRecommendedDesc",
      ),
      presetProgressive: T(
        "commands/moderation:warnSettings.quickstart.presetProgressive",
      ),
      presetProgressiveDesc: T(
        "commands/moderation:warnSettings.quickstart.presetProgressiveDesc",
      ),
      presetStrictStrike: T(
        "commands/moderation:warnSettings.quickstart.presetStrictStrike",
      ),
      presetStrictStrikeDesc: T(
        "commands/moderation:warnSettings.quickstart.presetStrictStrikeDesc",
      ),
      continue: T("commands/moderation:warnSettings.quickstart.continue"),
      generalOptionsTitle: T(
        "commands/moderation:warnSettings.quickstart.generalOptionsTitle",
      ),
      generalOptionsDescription: T(
        "commands/moderation:warnSettings.quickstart.generalOptionsDescription",
      ),
      defaultExpiry: T(
        "commands/moderation:warnSettings.quickstart.defaultExpiry",
      ),
      dmOnWarn: T("commands/moderation:warnSettings.quickstart.dmOnWarn"),
      logChannel: T("commands/moderation:warnSettings.quickstart.logChannel"),
      configureWarnLevels: T(
        "commands/moderation:warnSettings.quickstart.configureWarnLevels",
      ),
      back: T("commands/moderation:warnSettings.quickstart.back"),
      warnLevelsTitle: T(
        "commands/moderation:warnSettings.quickstart.warnLevelsTitle",
      ),
      warnLevelsDescription: T(
        "commands/moderation:warnSettings.quickstart.warnLevelsDescription",
      ),
      selectWarnLevel: T(
        "commands/moderation:warnSettings.quickstart.selectWarnLevel",
      ),
      addWarnLevel: T(
        "commands/moderation:warnSettings.quickstart.addWarnLevel",
      ),
      backToGeneral: T(
        "commands/moderation:warnSettings.quickstart.backToGeneral",
      ),
      continueToReview: T(
        "commands/moderation:warnSettings.quickstart.continueToReview",
      ),
      edit: T("commands/moderation:warnSettings.quickstart.edit"),
      remove: T("commands/moderation:warnSettings.quickstart.remove"),
      editWarnLevelTitle: FT<{ level: number }>(
        "commands/moderation:warnSettings.quickstart.editWarnLevelTitle",
      ),
      addWarnLevelTitle: T(
        "commands/moderation:warnSettings.quickstart.addWarnLevelTitle",
      ),
      actionType: T("commands/moderation:warnSettings.quickstart.actionType"),
      duration: T("commands/moderation:warnSettings.quickstart.duration"),
      durationPlaceholder: T(
        "commands/moderation:warnSettings.quickstart.durationPlaceholder",
      ),
      role: T("commands/moderation:warnSettings.quickstart.role"),
      rolePlaceholder: T(
        "commands/moderation:warnSettings.quickstart.rolePlaceholder",
      ),
      autoExecute: T("commands/moderation:warnSettings.quickstart.autoExecute"),
      autoExecuteYes: T(
        "commands/moderation:warnSettings.quickstart.autoExecuteYes",
      ),
      autoExecuteNo: T(
        "commands/moderation:warnSettings.quickstart.autoExecuteNo",
      ),
      save: T("commands/moderation:warnSettings.quickstart.save"),
      cancel: T("commands/moderation:warnSettings.quickstart.cancel"),
      reviewTitle: T("commands/moderation:warnSettings.quickstart.reviewTitle"),
      generalSettings: T(
        "commands/moderation:warnSettings.quickstart.generalSettings",
      ),
      expiryDays: FT<{ days: number }>(
        "commands/moderation:warnSettings.quickstart.expiryDays",
      ),
      warnLevelsSummary: FT<{ count: number }>(
        "commands/moderation:warnSettings.quickstart.warnLevelsSummary",
      ),
      levelNSummary: FT<{ level: number }>(
        "commands/moderation:warnSettings.quickstart.levelNSummary",
      ),
      saveConfiguration: T(
        "commands/moderation:warnSettings.quickstart.saveConfiguration",
      ),
      editWarnLevels: T(
        "commands/moderation:warnSettings.quickstart.editWarnLevels",
      ),
      savedTitle: T("commands/moderation:warnSettings.quickstart.savedTitle"),
      savedDescription: T(
        "commands/moderation:warnSettings.quickstart.savedDescription",
      ),
      cancelledTitle: T(
        "commands/moderation:warnSettings.quickstart.cancelledTitle",
      ),
      cancelledDescription: T(
        "commands/moderation:warnSettings.quickstart.cancelledDescription",
      ),
      timeoutTitle: T(
        "commands/moderation:warnSettings.quickstart.timeoutTitle",
      ),
      timeoutDescription: T(
        "commands/moderation:warnSettings.quickstart.timeoutDescription",
      ),
      invalidDuration: T(
        "commands/moderation:warnSettings.quickstart.invalidDuration",
      ),
      invalidAutoExecute: T(
        "commands/moderation:warnSettings.quickstart.invalidAutoExecute",
      ),
      none: T("commands/moderation:warnSettings.quickstart.none"),
      auto: T("commands/moderation:warnSettings.quickstart.auto"),
      manual: T("commands/moderation:warnSettings.quickstart.manual"),
      actionMute: T("commands/moderation:warnSettings.quickstart.actionMute"),
      actionKick: T("commands/moderation:warnSettings.quickstart.actionKick"),
      actionBan: T("commands/moderation:warnSettings.quickstart.actionBan"),
      actionRole: T("commands/moderation:warnSettings.quickstart.actionRole"),
      actionNone: T("commands/moderation:warnSettings.quickstart.actionNone"),
      actionMuteDesc: T(
        "commands/moderation:warnSettings.quickstart.actionMuteDesc",
      ),
      actionKickDesc: T(
        "commands/moderation:warnSettings.quickstart.actionKickDesc",
      ),
      actionBanDesc: T(
        "commands/moderation:warnSettings.quickstart.actionBanDesc",
      ),
      actionRoleDesc: T(
        "commands/moderation:warnSettings.quickstart.actionRoleDesc",
      ),
      actionNoneDesc: T(
        "commands/moderation:warnSettings.quickstart.actionNoneDesc",
      ),
      actionMessageDesc: T(
        "commands/moderation:warnSettings.quickstart.actionMessageDesc",
      ),
      punishments: T("commands/moderation:warnSettings.quickstart.punishments"),
      addPunishment: T(
        "commands/moderation:warnSettings.quickstart.addPunishment",
      ),
      editPunishment: T(
        "commands/moderation:warnSettings.quickstart.editPunishment",
      ),
      removePunishment: T(
        "commands/moderation:warnSettings.quickstart.removePunishment",
      ),
      levelDetails: T(
        "commands/moderation:warnSettings.quickstart.levelDetails",
      ),
      levelMessage: T(
        "commands/moderation:warnSettings.quickstart.levelMessage",
      ),
      levelMessagePlaceholder: T(
        "commands/moderation:warnSettings.quickstart.levelMessagePlaceholder",
      ),
      durationOptional: T(
        "commands/moderation:warnSettings.quickstart.durationOptional",
      ),
      durationPermanent: T(
        "commands/moderation:warnSettings.quickstart.durationPermanent",
      ),
      maxPunishments: T(
        "commands/moderation:warnSettings.quickstart.maxPunishments",
      ),
      confirmLevelTitle: FT<{ level: number }>(
        "commands/moderation:warnSettings.quickstart.confirmLevelTitle",
      ),
      confirmLevelDesc: FT<{ punishments: string }>(
        "commands/moderation:warnSettings.quickstart.confirmLevelDesc",
      ),
      confirmLevelConfirm: T(
        "commands/moderation:warnSettings.quickstart.confirmLevelConfirm",
      ),
      confirmLevelCancel: T(
        "commands/moderation:warnSettings.quickstart.confirmLevelCancel",
      ),
      confirmLevelDeclined: T(
        "commands/moderation:warnSettings.quickstart.confirmLevelDeclined",
      ),
      confirmLevelTimeout: T(
        "commands/moderation:warnSettings.quickstart.confirmLevelTimeout",
      ),
      punishmentMute: T(
        "commands/moderation:warnSettings.quickstart.punishmentMute",
      ),
      punishmentKick: T(
        "commands/moderation:warnSettings.quickstart.punishmentKick",
      ),
      punishmentBan: T(
        "commands/moderation:warnSettings.quickstart.punishmentBan",
      ),
      punishmentBanPerm: T(
        "commands/moderation:warnSettings.quickstart.punishmentBanPerm",
      ),
      punishmentRole: T(
        "commands/moderation:warnSettings.quickstart.punishmentRole",
      ),
      approvalApplySelected: T(
        "commands/moderation:warnSettings.quickstart.approvalApplySelected",
      ),
      approvalApplyAll: T(
        "commands/moderation:warnSettings.quickstart.approvalApplyAll",
      ),
      approvalDismiss: T(
        "commands/moderation:warnSettings.quickstart.approvalDismiss",
      ),
      approvalUnavailable: T(
        "commands/moderation:warnSettings.quickstart.approvalUnavailable",
      ),
      approvalTimedPunishment: FT<{ punishment: string; duration: string }>(
        "commands/moderation:warnSettings.quickstart.approvalTimedPunishment",
      ),
      approvalMessage: T(
        "commands/moderation:warnSettings.quickstart.approvalMessage",
      ),
    },
  },
  Case: {
    commandName: T("commands/moderation:case.commandName"),
    commandDescription: T("commands/moderation:case.commandDescription"),
    userFieldName: T("commands/moderation:case.userFieldName"),
    userFieldDescription: T("commands/moderation:case.userFieldDescription"),
    actionTypeFieldName: T("commands/moderation:case.actionTypeFieldName"),
    actionTypeFieldDescription: T(
      "commands/moderation:case.actionTypeFieldDescription",
    ),
    actionTypeAll: T("commands/moderation:case.actionTypeAll"),
    title: FT<{ user: string }>("commands/moderation:case.title"),
    noCases: T("commands/moderation:case.noCases"),
    page: FT<{ page: string; total: string }>("commands/moderation:case.page"),
    empty: T("commands/moderation:case.empty"),
    fields: {
      action: T("commands/moderation:case.fields.action"),
      moderator: T("commands/moderation:case.fields.moderator"),
      reason: T("commands/moderation:case.fields.reason"),
      dmStatus: T("commands/moderation:case.fields.dmStatus"),
      date: T("commands/moderation:case.fields.date"),
      notes: T("commands/moderation:case.fields.notes"),
    },
  },
  Note: {
    commandName: T("commands/moderation:note.commandName"),
    commandDescription: T("commands/moderation:note.commandDescription"),
    subcommandAddName: T("commands/moderation:note.subcommandAddName"),
    subcommandAddDescription: T(
      "commands/moderation:note.subcommandAddDescription",
    ),
    subcommandListName: T("commands/moderation:note.subcommandListName"),
    subcommandListDescription: T(
      "commands/moderation:note.subcommandListDescription",
    ),
    subcommandRemoveName: T("commands/moderation:note.subcommandRemoveName"),
    subcommandRemoveDescription: T(
      "commands/moderation:note.subcommandRemoveDescription",
    ),
    userFieldName: T("commands/moderation:note.userFieldName"),
    userFieldDescription: T("commands/moderation:note.userFieldDescription"),
    noteFieldName: T("commands/moderation:note.noteFieldName"),
    noteFieldDescription: T("commands/moderation:note.noteFieldDescription"),
    caseIdFieldName: T("commands/moderation:note.caseIdFieldName"),
    caseIdFieldDescription: T(
      "commands/moderation:note.caseIdFieldDescription",
    ),
    addedTitle: T("commands/moderation:note.addedTitle"),
    addedDesc: FT<{ user: string }>("commands/moderation:note.addedDesc"),
    listTitle: FT<{ user: string }>("commands/moderation:note.listTitle"),
    listEntry: FT<{ id: string; mod: string; note: string }>(
      "commands/moderation:note.listEntry",
    ),
    listEmpty: T("commands/moderation:note.listEmpty"),
    removedTitle: T("commands/moderation:note.removedTitle"),
    removedDesc: FT<{ id: string }>("commands/moderation:note.removedDesc"),
  },
  Errors: {
    targetNotInGuild: T("commands/moderation:errors.targetNotInGuild"),
    hierarchyTooLow: T("commands/moderation:errors.hierarchyTooLow"),
    botHierarchyTooLow: T("commands/moderation:errors.botHierarchyTooLow"),
    durationTooLong: T("commands/moderation:errors.durationTooLong"),
    warnSettingsNotConfigured: T(
      "commands/moderation:errors.warnSettingsNotConfigured",
    ),
    caseNotFound: T("commands/moderation:errors.caseNotFound"),
    warnAlreadyRevoked: T("commands/moderation:errors.warnAlreadyRevoked"),
    cannotActionSelf: T("commands/moderation:errors.cannotActionSelf"),
    cannotActionBot: T("commands/moderation:errors.cannotActionBot"),
    cannotActionAdmin: T("commands/moderation:errors.cannotActionAdmin"),
    invalidUserId: T("commands/moderation:errors.invalidUserId"),
    invalidAmount: T("commands/moderation:errors.invalidAmount"),
    invalidLevel: FT<{ max: string }>(
      "commands/moderation:errors.invalidLevel",
    ),
    multiWarnParseError: T("commands/moderation:errors.multiWarnParseError"),
  },
} as const;
