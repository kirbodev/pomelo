import { FT, T } from "../../types/utils.js";

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
    desc: FT<{ user: string }>("commands/moderation:mute.desc"),
    dmSent: T("commands/moderation:mute.dmSent"),
    dmNotSent: T("commands/moderation:mute.dmNotSent"),
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
    desc: FT<{ user: string }>("commands/moderation:warn.desc"),
    descTwice: FT<{ user: string }>("commands/moderation:warn.descTwice"),
    descThrice: FT<{ user: string }>("commands/moderation:warn.descThrice"),
    descTimes: FT<{ user: string; count: number }>(
      "commands/moderation:warn.descTimes",
    ),
    punishment: T("commands/moderation:warn.punishment"),
    punishmentN: FT<{ n: number }>("commands/moderation:warn.punishmentN"),
    punishmentMuteFor: FT<{ duration: string }>(
      "commands/moderation:warn.punishmentMuteFor",
    ),
    punishmentBanFor: FT<{ duration: string }>(
      "commands/moderation:warn.punishmentBanFor",
    ),
    punishmentAtLevel: FT<{ level: number }>(
      "commands/moderation:warn.punishmentAtLevel",
    ),
    punishmentWaiting: T("commands/moderation:warn.punishmentWaiting"),
    historyField: T("commands/moderation:warn.historyField"),
    historyCounts: FT<{ active: number; expired: number; total: number }>(
      "commands/moderation:warn.historyCounts",
    ),
    historyEntry: FT<{ id: string; reason: string; expiry: string }>(
      "commands/moderation:warn.historyEntry",
    ),
    historyEntryNoExpiry: FT<{ id: string; reason: string }>(
      "commands/moderation:warn.historyEntryNoExpiry",
    ),
    removedTitle: T("commands/moderation:warn.removedTitle"),
    removedDesc: FT<{ id: string }>("commands/moderation:warn.removedDesc"),
    multiTitle: FT<{ count: number }>(
      "commands/moderation:warn.multiTitle_other",
    ),
    heavywarnCommandName: T("commands/moderation:warn.heavywarnCommandName"),
    heavywarnCommandDescription: T(
      "commands/moderation:warn.heavywarnCommandDescription",
    ),
    warnsCommandName: T("commands/moderation:warn.warnsCommandName"),
    warnsCommandDescription: T(
      "commands/moderation:warn.warnsCommandDescription",
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
      dmEnabled: T("commands/moderation:warnSettings.quickstart.dmEnabled"),
      dmDisabled: T("commands/moderation:warnSettings.quickstart.dmDisabled"),
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
      levelDetailsTitle: FT<{ level: number }>(
        "commands/moderation:warnSettings.quickstart.levelDetailsTitle",
      ),
      editMessage: T("commands/moderation:warnSettings.quickstart.editMessage"),
      clearMessage: T(
        "commands/moderation:warnSettings.quickstart.clearMessage",
      ),
      noLevelMessage: T(
        "commands/moderation:warnSettings.quickstart.noLevelMessage",
      ),
      autoExecuteDesc: T(
        "commands/moderation:warnSettings.quickstart.autoExecuteDesc",
      ),
      reviewDescription: T(
        "commands/moderation:warnSettings.quickstart.reviewDescription",
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
      confirmLevelPending: T(
        "commands/moderation:warnSettings.quickstart.confirmLevelPending",
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
      selectGeneralSettingPlaceholder: T(
        "commands/moderation:warnSettings.quickstart.selectGeneralSettingPlaceholder",
      ),
      selectPunishmentPlaceholder: T(
        "commands/moderation:warnSettings.quickstart.selectPunishmentPlaceholder",
      ),
      selectPunishmentTypeTitle: T(
        "commands/moderation:warnSettings.quickstart.selectPunishmentTypeTitle",
      ),
      confirmAddPunishment: T(
        "commands/moderation:warnSettings.quickstart.confirmAddPunishment",
      ),
      cancelAddPunishment: T(
        "commands/moderation:warnSettings.quickstart.cancelAddPunishment",
      ),
      interactionExpired: T(
        "commands/moderation:warnSettings.quickstart.interactionExpired",
      ),
      alreadyHasPunishment: FT<{ type: string }>(
        "commands/moderation:warnSettings.quickstart.alreadyHasPunishment",
      ),
      addPunishmentButton: T(
        "commands/moderation:warnSettings.quickstart.addPunishmentButton",
      ),
      punishmentTypeSelect: T(
        "commands/moderation:warnSettings.quickstart.punishmentTypeSelect",
      ),
      noPunishmentsYet: T(
        "commands/moderation:warnSettings.quickstart.noPunishmentsYet",
      ),
      editExistingDescription: T(
        "commands/moderation:warnSettings.quickstart.editExistingDescription",
      ),
      resetButton: T("commands/moderation:warnSettings.quickstart.resetButton"),
      resetConfirmTitle: T(
        "commands/moderation:warnSettings.quickstart.resetConfirmTitle",
      ),
      resetConfirmDescription: T(
        "commands/moderation:warnSettings.quickstart.resetConfirmDescription",
      ),
      resetConfirmContinue: T(
        "commands/moderation:warnSettings.quickstart.resetConfirmContinue",
      ),
      resetConfirmCancel: T(
        "commands/moderation:warnSettings.quickstart.resetConfirmCancel",
      ),
      resetModalTitle: T(
        "commands/moderation:warnSettings.quickstart.resetModalTitle",
      ),
      resetModalLabel: T(
        "commands/moderation:warnSettings.quickstart.resetModalLabel",
      ),
      resetModalMismatch: T(
        "commands/moderation:warnSettings.quickstart.resetModalMismatch",
      ),
      resetDoneTitle: T(
        "commands/moderation:warnSettings.quickstart.resetDoneTitle",
      ),
      resetDoneDescription: FT<{ timestamp: string }>(
        "commands/moderation:warnSettings.quickstart.resetDoneDescription",
      ),
      resetLogTitle: T(
        "commands/moderation:warnSettings.quickstart.resetLogTitle",
      ),
      resetLogMessage: FT<{ user: string }>(
        "commands/moderation:warnSettings.quickstart.resetLogMessage",
      ),
      restoreButton: T(
        "commands/moderation:warnSettings.quickstart.restoreButton",
      ),
      startOverButton: T(
        "commands/moderation:warnSettings.quickstart.startOverButton",
      ),
      restoreHint: T("commands/moderation:warnSettings.quickstart.restoreHint"),
      restoreExpired: T(
        "commands/moderation:warnSettings.quickstart.restoreExpired",
      ),
      restoredTitle: T(
        "commands/moderation:warnSettings.quickstart.restoredTitle",
      ),
      restoredDescription: T(
        "commands/moderation:warnSettings.quickstart.restoredDescription",
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
    caseHeader: FT<{ id: string; action: string }>(
      "commands/moderation:case.caseHeader",
    ),
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
  Fields: {
    reason: T("commands/moderation:fields.reason"),
    duration: T("commands/moderation:fields.duration"),
    dm: T("commands/moderation:fields.dm"),
    moderator: T("commands/moderation:fields.moderator"),
    users: T("commands/moderation:fields.users"),
    messagesDeleted: T("commands/moderation:fields.messagesDeleted"),
    noReason: T("commands/moderation:fields.noReason"),
    never: T("commands/moderation:fields.never"),
    unknown: T("commands/moderation:fields.unknown"),
    note: T("commands/moderation:fields.note"),
    notesCount: FT<{ count: number }>(
      "commands/moderation:fields.notesCount_other",
    ),
  },
  SecuritySettings: {
    commandName: T("commands/moderation:securitySettings.commandName"),
    commandDescription: T(
      "commands/moderation:securitySettings.commandDescription",
    ),
    subcommandOverviewName: T(
      "commands/moderation:securitySettings.subcommandOverviewName",
    ),
    subcommandOverviewDescription: T(
      "commands/moderation:securitySettings.subcommandOverviewDescription",
    ),
    subcommandQrName: T(
      "commands/moderation:securitySettings.subcommandQrName",
    ),
    subcommandQrDescription: T(
      "commands/moderation:securitySettings.subcommandQrDescription",
    ),
    subcommandQuickstartName: T(
      "commands/moderation:securitySettings.subcommandQuickstartName",
    ),
    subcommandQuickstartDescription: T(
      "commands/moderation:securitySettings.subcommandQuickstartDescription",
    ),
    overviewTitle: T("commands/moderation:securitySettings.overviewTitle"),
    qrTitle: T("commands/moderation:securitySettings.qrTitle"),
    featureQr: T("commands/moderation:securitySettings.featureQr"),
    enabled: T("commands/moderation:securitySettings.enabled"),
    disabled: T("commands/moderation:securitySettings.disabled"),
    notConfigured: T("commands/moderation:securitySettings.notConfigured"),
    qrMode: T("commands/moderation:securitySettings.qrMode"),
    qrModeAllowlist: T("commands/moderation:securitySettings.qrModeAllowlist"),
    qrModeBlocklist: T("commands/moderation:securitySettings.qrModeBlocklist"),
    qrModeOff: T("commands/moderation:securitySettings.qrModeOff"),
    qrDefaultBlocklist: T(
      "commands/moderation:securitySettings.qrDefaultBlocklist",
    ),
    qrDescDefaultBlocklist: T(
      "commands/moderation:securitySettings.qrDescDefaultBlocklist",
    ),
    qrDefaultAllowlist: T(
      "commands/moderation:securitySettings.qrDefaultAllowlist",
    ),
    qrDescDefaultAllowlist: T(
      "commands/moderation:securitySettings.qrDescDefaultAllowlist",
    ),
    qrCustomBlocklist: T(
      "commands/moderation:securitySettings.qrCustomBlocklist",
    ),
    qrDescCustomBlocklist: T(
      "commands/moderation:securitySettings.qrDescCustomBlocklist",
    ),
    qrCustomAllowlist: T(
      "commands/moderation:securitySettings.qrCustomAllowlist",
    ),
    qrDescCustomAllowlist: T(
      "commands/moderation:securitySettings.qrDescCustomAllowlist",
    ),
    qrNoEntries: T("commands/moderation:securitySettings.qrNoEntries"),
    qrEntryCount: FT<{ count: number }>(
      "commands/moderation:securitySettings.qrEntryCount",
    ),
    qrSafeChannel: T("commands/moderation:securitySettings.qrSafeChannel"),
    qrUnsafeChannel: T("commands/moderation:securitySettings.qrUnsafeChannel"),
    qrDeleteOnUnsafe: T(
      "commands/moderation:securitySettings.qrDeleteOnUnsafe",
    ),
    qrToggleEnabled: T("commands/moderation:securitySettings.qrToggleEnabled"),
    qrToggleDisabled: T(
      "commands/moderation:securitySettings.qrToggleDisabled",
    ),
    qrChangeMode: T("commands/moderation:securitySettings.qrChangeMode"),
    qrUnsafeAlertTitle: T(
      "commands/moderation:securitySettings.qrUnsafeAlertTitle",
    ),
    qrUnsafeAlertAuthor: T(
      "commands/moderation:securitySettings.qrUnsafeAlertAuthor",
    ),
    qrUnsafeAlertChannel: T(
      "commands/moderation:securitySettings.qrUnsafeAlertChannel",
    ),
    qrUnsafeAlertContentType: T(
      "commands/moderation:securitySettings.qrUnsafeAlertContentType",
    ),
    qrSafeAlertTitle: T(
      "commands/moderation:securitySettings.qrSafeAlertTitle",
    ),
    qrSafeAlertAuthor: T(
      "commands/moderation:securitySettings.qrSafeAlertAuthor",
    ),
    qrSafeAlertChannel: T(
      "commands/moderation:securitySettings.qrSafeAlertChannel",
    ),
    qrSafeAlertContentType: T(
      "commands/moderation:securitySettings.qrSafeAlertContentType",
    ),
    qrLogTitle: T("commands/moderation:securitySettings.qrLogTitle"),
    qrLogResult: T("commands/moderation:securitySettings.qrLogResult"),
    qrLogResultUnsafe: T(
      "commands/moderation:securitySettings.qrLogResultUnsafe",
    ),
    qrLogResultSafe: T("commands/moderation:securitySettings.qrLogResultSafe"),
    qrLogResultNoMatch: T(
      "commands/moderation:securitySettings.qrLogResultNoMatch",
    ),
    qrLogAuthor: T("commands/moderation:securitySettings.qrLogAuthor"),
    qrLogChannel: T("commands/moderation:securitySettings.qrLogChannel"),
    qrLogContentType: T(
      "commands/moderation:securitySettings.qrLogContentType",
    ),
    qrSafeActionLabel: T(
      "commands/moderation:securitySettings.qrSafeActionLabel",
    ),
    qrUnsafeActionLabel: T(
      "commands/moderation:securitySettings.qrUnsafeActionLabel",
    ),
    qrSetSafeChannel: T(
      "commands/moderation:securitySettings.qrSetSafeChannel",
    ),
    qrSetUnsafeChannel: T(
      "commands/moderation:securitySettings.qrSetUnsafeChannel",
    ),
    qrSetLogChannel: T("commands/moderation:securitySettings.qrSetLogChannel"),
    qrToggleSafeAction: T(
      "commands/moderation:securitySettings.qrToggleSafeAction",
    ),
    qrToggleUnsafeAction: T(
      "commands/moderation:securitySettings.qrToggleUnsafeAction",
    ),
    qrAddEntry: T("commands/moderation:securitySettings.qrAddEntry"),
    qrRemoveEntry: T("commands/moderation:securitySettings.qrRemoveEntry"),
    qrAddDomainModalTitleBlocklist: T(
      "commands/moderation:securitySettings.qrAddDomainModalTitleBlocklist",
    ),
    qrAddDomainModalTitleAllowlist: T(
      "commands/moderation:securitySettings.qrAddDomainModalTitleAllowlist",
    ),
    qrModalDomainInput: T(
      "commands/moderation:securitySettings.qrModalDomainInput",
    ),
    qrModalDomainPlaceholder: T(
      "commands/moderation:securitySettings.qrModalDomainPlaceholder",
    ),
    qrInvalidDomain: T("commands/moderation:securitySettings.qrInvalidDomain"),
    qrDuplicateDomain: T(
      "commands/moderation:securitySettings.qrDuplicateDomain",
    ),
    qrMaxEntriesReached: T(
      "commands/moderation:securitySettings.qrMaxEntriesReached",
    ),
    qrDomainAdded: FT<{ domain: string }>(
      "commands/moderation:securitySettings.qrDomainAdded",
    ),
    qrDomainRemoved: FT<{ domain: string }>(
      "commands/moderation:securitySettings.qrDomainRemoved",
    ),
    qrSelectEntryToRemove: T(
      "commands/moderation:securitySettings.qrSelectEntryToRemove",
    ),
    qrDescMode: T("commands/moderation:securitySettings.qrDescMode"),
    qrDescSafeAction: T(
      "commands/moderation:securitySettings.qrDescSafeAction",
    ),
    qrDescSafeChannel: T(
      "commands/moderation:securitySettings.qrDescSafeChannel",
    ),
    qrDescUnsafeAction: T(
      "commands/moderation:securitySettings.qrDescUnsafeAction",
    ),
    qrDescUnsafeChannel: T(
      "commands/moderation:securitySettings.qrDescUnsafeChannel",
    ),
    qrDescDeleteOnUnsafe: T(
      "commands/moderation:securitySettings.qrDescDeleteOnUnsafe",
    ),
    qrQuickstartTitle: T(
      "commands/moderation:securitySettings.qrQuickstartTitle",
    ),
    qrQuickstepWelcome: T(
      "commands/moderation:securitySettings.qrQuickstepWelcome",
    ),
    qrQuickstepEnable: T(
      "commands/moderation:securitySettings.qrQuickstepEnable",
    ),
    qrQuickstepMode: T("commands/moderation:securitySettings.qrQuickstepMode"),
    qrQuickstepChannels: T(
      "commands/moderation:securitySettings.qrQuickstepChannels",
    ),
    qrQuickstepDeleteToggle: T(
      "commands/moderation:securitySettings.qrQuickstepDeleteToggle",
    ),
    qrQuickstepSummary: T(
      "commands/moderation:securitySettings.qrQuickstepSummary",
    ),
    qrQuickstartEnable: T(
      "commands/moderation:securitySettings.qrQuickstartEnable",
    ),
    qrQuickstartSkip: T(
      "commands/moderation:securitySettings.qrQuickstartSkip",
    ),
    qrQuickstartBack: T(
      "commands/moderation:securitySettings.qrQuickstartBack",
    ),
    qrQuickstartNext: T(
      "commands/moderation:securitySettings.qrQuickstartNext",
    ),
    qrQuickstartFinish: T(
      "commands/moderation:securitySettings.qrQuickstartFinish",
    ),
    qrQuickstartDone: T(
      "commands/moderation:securitySettings.qrQuickstartDone",
    ),
    qrQuickstartConfirmTitle: T(
      "commands/moderation:securitySettings.qrQuickstartConfirmTitle",
    ),
    qrDeleteMessage: T("commands/moderation:securitySettings.qrDeleteMessage"),
    qrMessageDeleted: T(
      "commands/moderation:securitySettings.qrMessageDeleted",
    ),
    qrAutoDeletedNotice: FT<{ user: string }>(
      "commands/moderation:securitySettings.qrAutoDeletedNotice",
    ),
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
  QuickActions: {
    mute: T("commands/moderation:QuickActions.mute"),
    kick: T("commands/moderation:QuickActions.kick"),
    ban: T("commands/moderation:QuickActions.ban"),
    warn: T("commands/moderation:QuickActions.warn"),
    actionSuccess: FT<{ action: string }>(
      "commands/moderation:QuickActions.actionSuccess",
    ),
    actionFailed: FT<{ action: string }>(
      "commands/moderation:QuickActions.actionFailed",
    ),
    configTitle: T("commands/moderation:QuickActions.configTitle"),
    noActions: T("commands/moderation:QuickActions.noActions"),
    addAction: T("commands/moderation:QuickActions.addAction"),
    removeAction: T("commands/moderation:QuickActions.removeAction"),
    actionLabelLabel: T("commands/moderation:QuickActions.actionLabelLabel"),
    customActionNamePlaceholder: T(
      "commands/moderation:QuickActions.customActionNamePlaceholder",
    ),
    messageLabel: T("commands/moderation:QuickActions.messageLabel"),
    subWarn: T("commands/moderation:QuickActions.subWarn"),
    subMute: T("commands/moderation:QuickActions.subMute"),
    subAddRole: T("commands/moderation:QuickActions.subAddRole"),
    subSendDm: T("commands/moderation:QuickActions.subSendDm"),
    subKick: T("commands/moderation:QuickActions.subKick"),
    subBan: T("commands/moderation:QuickActions.subBan"),
    wizardTitle: T("commands/moderation:QuickActions.wizardTitle"),
    wizardStep1: T("commands/moderation:QuickActions.wizardStep1"),
    wizardStep3: T("commands/moderation:QuickActions.wizardStep3"),
    wizardContinue: T("commands/moderation:QuickActions.wizardContinue"),
    wizardCancel: T("commands/moderation:QuickActions.wizardCancel"),
    wizardBack: T("commands/moderation:QuickActions.wizardBack"),
    wizardDone: T("commands/moderation:QuickActions.wizardDone"),
    wizardNameTitle: T("commands/moderation:QuickActions.wizardNameTitle"),
    wizardNameLabel: T("commands/moderation:QuickActions.wizardNameLabel"),
    triggersPlaceholder: T(
      "commands/moderation:QuickActions.triggersPlaceholder",
    ),
    triggersDescription: T(
      "commands/moderation:QuickActions.triggersDescription",
    ),
    triggersLabel: T("commands/moderation:QuickActions.triggersLabel"),
    triggersSelected: T("commands/moderation:QuickActions.triggersSelected"),
    clickContinue: T("commands/moderation:QuickActions.clickContinue"),
    selectTriggersFirst: T(
      "commands/moderation:QuickActions.selectTriggersFirst",
    ),
    subactionsLabel: T("commands/moderation:QuickActions.subactionsLabel"),
    addSubaction: T("commands/moderation:QuickActions.addSubaction"),
    selectSubactionType: T(
      "commands/moderation:QuickActions.selectSubactionType",
    ),
    noSubactionsYet: T("commands/moderation:QuickActions.noSubactionsYet"),
    configureSubaction: T(
      "commands/moderation:QuickActions.configureSubaction",
    ),
    warnAmountLabel: T("commands/moderation:QuickActions.warnAmountLabel"),
    durationLabel: T("commands/moderation:QuickActions.durationLabel"),
    roleIdLabel: T("commands/moderation:QuickActions.roleIdLabel"),
    reasonLabel: T("commands/moderation:QuickActions.reasonLabel"),
    invalidName: T("commands/moderation:QuickActions.invalidName"),
    invalidWarnAmount: T("commands/moderation:QuickActions.invalidWarnAmount"),
    invalidDuration: T("commands/moderation:QuickActions.invalidDuration"),
    invalidRoleId: T("commands/moderation:QuickActions.invalidRoleId"),
    invalidDmMessage: T("commands/moderation:QuickActions.invalidDmMessage"),
    needAtLeastOneSubaction: T(
      "commands/moderation:QuickActions.needAtLeastOneSubaction",
    ),
    validationFailed: T("commands/moderation:QuickActions.validationFailed"),
    quickActionSaved: T("commands/moderation:QuickActions.quickActionSaved"),
    quickActionDeleted: T(
      "commands/moderation:QuickActions.quickActionDeleted",
    ),
    wizardCancelled: T("commands/moderation:QuickActions.wizardCancelled"),
  },
} as const;
