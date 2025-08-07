// Since we are not using an ORM, always validate the data against the schema before saving it to the database.
import { Locale } from "discord.js";
import { z } from "zod";

const ChannelRegex = /^\d{17,20}$/gm;

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
});

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
});

export type Afk = z.infer<typeof Afk>;
