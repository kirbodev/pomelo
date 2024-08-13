import { Redis, type RedisOptions } from "ioredis";
import { container } from "@sapphire/framework";
import * as Schemas from "./schema.js";
import { z, ZodType } from "zod";
import { objectKeys } from "@sapphire/utilities";
import type { NullPartial } from "../../lib/types/utils.js";

type InferSchemaType<T> = T extends ZodType<infer U> ? U : never;
export const topics = objectKeys(Schemas);

/**
 * A Redis client with JSON schema validation
 * @extends Redis
 */
export class PomeloRedis extends Redis {
  constructor(options: RedisOptions) {
    super(options);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (container.logger) {
      this.on("error", (error) => {
        container.logger.error("Redis error:", error);
      });

      this.on("connect", () => {
        container.logger.info("Connected to Redis");
      });

      this.on("reconnecting", () => {
        container.logger.info("Reconnecting to Redis");
      });

      this.on("end", () => {
        container.logger.info("Disconnected from Redis");
      });

      this.on("close", () => {
        container.logger.info("Redis connection closed");
      });

      this.on("ready", () => {
        container.logger.info("Redis connection ready");
      });
    }
  }

  /**
   * Gets a JSON object from a key with a topic/schema
   * @param key The key of the object
   * @param topic The topic of the object (schema)
   * @returns Schema object of the topic or null if not found
   */
  async jsonGet<T extends keyof typeof Schemas>(key: string, topic: T) {
    if (!topics.includes(topic)) throw new Error("Invalid topic | Not found");
    if (key === "") throw new Error("Key cannot be empty");
    if (key.includes(" ")) throw new Error("Key cannot contain spaces");

    const data = (await this.call("JSON.GET", `${topic}:${key}`, "$")) as
      | string
      | null;
    if (!data) return null;
    const res = (JSON.parse(data) as [z.infer<(typeof Schemas)[T]>])[0];
    return res;
  }

  /**
   * Sets a JSON object to a key with a topic/schema
   * @param key The key of the object
   * @param topic The topic of the object (schema)
   * @param value The value to set, must match the schema
   * @param condition NX or XX, NX will only set the value if the key does not exist, XX will only set the value if the key exists
   * @returns True if the value was set, false if not
   */
  async jsonSet<T extends keyof typeof Schemas>(
    key: string,
    topic: T,
    value: InferSchemaType<(typeof Schemas)[T]>,
    condition?: "NX" | "XX"
  ) {
    if (!topics.includes(topic)) throw new Error("Invalid topic | Not found");
    const validate = Schemas[topic].safeParse(value);
    if (!validate.success) throw new Error(validate.error.message);
    return (
      (await this.call(
        "JSON.SET",
        `${topic}:${key}`,
        "$",
        JSON.stringify(validate.data),
        ...(condition ? [condition] : [])
      )) === "OK"
    );
  }

  /**
   * Updates a JSON object with a partial object
   * @param key The key of the object
   * @param topic The topic of the object (schema)
   * @param value The value to set, must match the schema
   * @remark For value: null keys will delete the path and arrays will replace the path, not merge. Otherwise, it will merge the object
   * @alias jsonMerge
   * @returns True if the value was set, false if not
   */
  async jsonUpdate<T extends keyof typeof Schemas>(
    key: string,
    topic: T,
    value: NullPartial<InferSchemaType<(typeof Schemas)[T]>>
  ) {
    if (!topics.includes(topic)) throw new Error("Invalid topic | Not found");
    const validate = this.nullable(Schemas[topic].partial()).safeParse(value);
    if (!validate.success) throw new Error(validate.error.message);
    if ("updatedAt" in Schemas[topic].shape && !("updatedAt" in value))
      Reflect.set(value, "updatedAt", new Date());
    return (
      (await this.call(
        "JSON.MERGE",
        `${topic}:${key}`,
        "$",
        JSON.stringify(value)
      )) === "OK"
    );
  }

  /**
   * Only exists for alias purposes, and to keep concurrency with Redis commands
   * Use jsonUpdate instead
   * @deprecated
   * @alias jsonUpdate
   */
  jsonMerge = this.jsonUpdate.bind(this);

  /**
   * Deletes a path from a JSON object (or the whole object if path is not provided)
   * @param key The key of the object
   * @param topic The topic of the object (schema)
   * @param path The path to delete
   * @remarks WARNING: Always make sure the path can be deleted, there is no validation for this!
   * @returns The number of paths deleted
   */
  async jsonDel(
    key: string,
    topic: keyof typeof Schemas,
    path?: `$.${string}`
  ) {
    if (!topics.includes(topic)) throw new Error("Invalid topic | Not found");
    return (await this.call(
      "JSON.DEL",
      `${topic}:${key}`,
      path ?? "$"
    )) as number;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private nullable<TSchema extends z.AnyZodObject>(schema: TSchema) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const entries = Object.entries(schema.shape) as [
      keyof TSchema["shape"],
      z.ZodTypeAny
    ][];

    const newProps = entries.reduce((acc, [key, value]) => {
      acc[key] = value.nullable();
      return acc;
      // eslint-disable-next-line @typescript-eslint/prefer-reduce-type-parameter
    }, {} as { [key in keyof TSchema["shape"]]: z.ZodNullable<TSchema["shape"][key]> });

    return z.object(newProps);
  }
}
