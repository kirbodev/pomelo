// Since we are not using an ORM, always validate the data against the schema before saving it to the database.
import { Locale } from "discord.js";
import { z } from "zod";

const ChannelRegex = /^\d{17,20}$/;

//NOTE - ONLY USE THIS FOR TESTING
export const Test = z.object({
  a: z.string(),
  b: z.number().optional(),
  c: z.array(z.string()),
  d: z.object({
    e: z.string().optional(),
    f: z.number(),
    g: z.array(z.string()),
  }),
  e: z.array(
    z.object({
      f: z.string(),
      g: z.number(),
      h: z.array(z.string()).optional(),
    }),
  ),
  f: z.enum(["a", "b", "c"]),
});

export const UserSettings = z.object({
  createdAt: z
    .date({
      coerce: true,
    })
    .default(new Date()),
  updatedAt: z
    .date({
      coerce: true,
    })
    .default(new Date()),
  locale: z.nativeEnum(Locale),
  preferEphemeral: z.boolean().default(true),
  allowUrgentPings: z.boolean().default(true),
  autoAfkRemoval: z.boolean().default(false),
});

export const SubActionSchema = z.object({
  type: z.enum(["warn", "mute", "addRole", "sendDm", "kick", "ban"]),
  warnAmount: z.number().min(1).max(10).optional(),
  warnReason: z.string().max(512).optional(),
  muteDuration: z.number().positive().optional(),
  roleId: z.string().optional(),
  dmMessage: z.string().max(2000).optional(),
  kickReason: z.string().max(512).optional(),
  banReason: z.string().max(512).optional(),
  banDuration: z.number().positive().optional(),
  banDeleteMessageDays: z.number().optional(),
});

export const QuickActionDefinitionSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
  triggers: z.array(z.enum(["mute", "warn"])).min(1),
  subactions: z.array(SubActionSchema).min(1).max(5),
});

const QuickActionsConfigObject = z.object({
  actions: z.array(QuickActionDefinitionSchema).default([]),
});

export const QuickActionsConfigSchema = QuickActionsConfigObject
  .default({ actions: [] });

export const GuildSettings = z.object({
  createdAt: z
    .date({
      coerce: true,
    })
    .default(new Date()),
  updatedAt: z
    .date({
      coerce: true,
    })
    .default(new Date()),
  locale: z.nativeEnum(Locale).default(Locale.EnglishUS),
  forceLocale: z.boolean().default(false),
  prefix: z.string().min(1).max(5).default(","),
  logChannel: z.string().regex(ChannelRegex).optional(),
  forceEphemeral: z.boolean().default(false),
  ephemeralDeletionTimeout: z
    .number({
      coerce: true,
    })
    .min(3)
    .max(60)
    .default(10),
  afkEnabled: z.boolean().default(true),
  blockAfkMentions: z.boolean().default(false),
  announcementChannel: z.string().regex(ChannelRegex).optional(),
  quickActions: QuickActionsConfigSchema,
});

export const Afk = z.object({
  startedAt: z
    .date({
      coerce: true,
    })
    .default(new Date()),
  endsAt: z
    .date({
      coerce: true,
    })
    .nullable()
    .default(null),
  text: z.string().min(1).max(512).optional(),
  attachment: z.string().optional(),
  eventId: z.string().optional(),
  // Armed by the presence listener once the user goes offline while AFK;
  // coming back online only auto-removes when this is set.
  wentOffline: z.boolean().optional(),
  pastUsername: z
    .array(
      z.object({
        guildId: z.string(),
        username: z.string(),
      }),
    )
    .optional(),
});

export type Afk = z.infer<typeof Afk>;

export const QrScanner = z.object({
  mode: z.enum(["allowlist", "blocklist", "off"]).default("off"),
  customAllowlist: z.array(z.string()).default([]),
  customBlocklist: z.array(z.string()).default([]),
  defaultBlocklistEnabled: z.boolean().default(false),
  defaultAllowlistEnabled: z.boolean().default(false),
  safeAction: z
    .object({
      enabled: z.boolean().default(false),
      channelId: z.string().regex(ChannelRegex).optional(),
    })
    .default({}),
  unsafeAction: z
    .object({
      enabled: z.boolean().default(true),
      channelId: z.string().regex(ChannelRegex).optional(),
      deleteMessage: z.boolean().default(true),
    })
    .default({}),
});

export type QrScannerSettings = z.infer<typeof QrScanner>;
