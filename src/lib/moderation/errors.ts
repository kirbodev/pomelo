export class ModerationError extends Error {
  constructor(public key: string, public context?: Record<string, unknown>) {
    super(key);
  }
}

export const ModErrors = {
  TargetNotInGuild: "targetNotInGuild",
  HierarchyTooLow: "hierarchyTooLow",
  BotHierarchyTooLow: "botHierarchyTooLow",
  DurationTooLong: "durationTooLong",
  CaseNotFound: "caseNotFound",
  WarnAlreadyRevoked: "warnAlreadyRevoked",
} as const;
