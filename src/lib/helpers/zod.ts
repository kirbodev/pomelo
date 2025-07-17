import { objectEntries } from "@sapphire/utilities";
import { z } from "zod";
import { fetchT, type Target } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../i18n/languageKeys.js";

export function getMinMax<T extends z.SomeZodObject>(
  schema: T,
  setting: keyof T["shape"]
) {
  const entry = objectEntries(schema.shape).find(
    ([key]) => key === setting
  )?.[1];
  let inner = null;
  if (entry instanceof z.ZodOptional) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    inner = entry.unwrap();
  }
  if (entry instanceof z.ZodDefault) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const type = entry._def.innerType;
    if (type instanceof z.ZodString || type instanceof z.ZodNumber) {
      inner = type;
    }
  } else if (entry instanceof z.ZodString || entry instanceof z.ZodNumber) {
    inner = entry;
  }
  // @ts-expect-error - Type is any from z.SomeZodObject
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const min = inner?._def.checks.find((c) => c.kind === "min")?.value;
  // @ts-expect-error - Type is any from z.SomeZodObject
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const max = inner?._def.checks.find((c) => c.kind === "max")?.value;
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    min,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    max,
  } as {
    min: number | undefined;
    max: number | undefined;
  };
}

export async function internationalizeError(
  errors: z.ZodError,
  target: Target
) {
  const t = await fetchT(target);

  const error = errors.errors[0];
  const code = error.code;

  let title = t(LanguageKeys.Errors.GenericError.title);
  let desc = `${t(LanguageKeys.Errors.GenericError.desc)}
    ${error.message}`;

  if (code === z.ZodIssueCode.invalid_enum_value) {
    title = t(LanguageKeys.Errors.InvalidOption.title);
    desc = t(LanguageKeys.Errors.InvalidOption.desc_detailed, {
      option: error.options[0],
    });
  }
  if (code === z.ZodIssueCode.invalid_string) {
    title = t(LanguageKeys.Errors.InvalidString.title);
    desc = t(LanguageKeys.Errors.InvalidString.desc_detailed, {
      string_type: error.validation,
    });
  }
  if (code === z.ZodIssueCode.too_small) {
    if (error.type === "number" || error.type === "bigint") {
      title = t(LanguageKeys.Errors.NumberTooSmall.title);
      desc = t(LanguageKeys.Errors.NumberTooSmall.desc_detailed, {
        length: error.minimum,
      });
    }
    if (error.type === "string") {
      title = t(LanguageKeys.Errors.StringTooShort.title);
      desc = t(LanguageKeys.Errors.StringTooShort.desc_detailed, {
        length: error.minimum,
      });
    }
  }
  if (code === z.ZodIssueCode.too_big) {
    if (error.type === "number" || error.type === "bigint") {
      title = t(LanguageKeys.Errors.NumberTooLarge.title);
      desc = t(LanguageKeys.Errors.NumberTooLarge.desc_detailed, {
        length: error.maximum,
      });
    }
    if (error.type === "string") {
      title = t(LanguageKeys.Errors.StringTooLong.title);
      desc = t(LanguageKeys.Errors.StringTooLong.desc_detailed, {
        length: error.maximum,
      });
    }
  }
  if (code === z.ZodIssueCode.invalid_type) {
    if (error.expected === "number" || error.expected === "bigint") {
      title = t(LanguageKeys.Errors.InvalidNumber.title);
      desc = t(LanguageKeys.Errors.InvalidNumber.desc);
    } else if (error.expected === "string") {
      title = t(LanguageKeys.Errors.InvalidString.title);
      desc = t(LanguageKeys.Errors.InvalidString.desc);
    } else if (error.expected === "boolean") {
      title = t(LanguageKeys.Errors.InvalidBoolean.title);
      desc = t(LanguageKeys.Errors.InvalidBoolean.desc);
    } else {
      title = t(LanguageKeys.Errors.InvalidType.title);
      desc = t(LanguageKeys.Errors.InvalidType.desc_detailed, {
        expected: error.expected,
        received: error.received,
      });
    }
  }

  return {
    title,
    desc,
  };
}
