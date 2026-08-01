// Tests for Pomelo Redis
import type { z } from "zod";
import { PomeloRedis } from "../src/db/redis/json.js";
import { Test } from "../src/db/redis/schema.js";
import { test, expect } from "bun:test";

const redis = new PomeloRedis({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
  username: process.env.REDIS_PASSWORD ? "default" : undefined,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  keyPrefix: "test",
});

const testData: z.infer<typeof Test> = {
  a: "test",
  c: ["test"],
  d: {
    e: "test",
    f: 1,
    g: ["test"],
  },
  e: [
    {
      f: "test",
      g: 1,
      h: ["test"],
    },
  ],
  f: "a" as const,
};

// Remote Redis round trips are slow; the default 5s timeout is not enough
const TEST_TIMEOUT = 30_000;

test(
  "JSON.GET",
  async () => {
    await redis.jsonDel("test", "Test");
    const value = await redis.jsonGet("test", "Test");
    expect(value).toBe(null);
    await redis.jsonSet("test", "Test", testData);
    const value2 = await redis.jsonGet("test", "Test");
    expect(value2).toStrictEqual(testData);

    // Remove the data
    await redis.jsonDel("test", "Test");
  },
  TEST_TIMEOUT,
);

test(
  "JSON.SET",
  async () => {
    await redis.jsonSet("test", "Test", testData);
    const value = await redis.jsonGet("test", "Test");
    expect(value).toStrictEqual(testData);
    const newData = testData;
    newData.b = 2;
    await redis.jsonSet("test", "Test", newData, "XX");
    const value2 = await redis.jsonGet("test", "Test");
    expect(value2).toStrictEqual(newData);
    await redis.jsonSet("test", "Test", newData, "NX");
    const value3 = await redis.jsonGet("test", "Test");
    expect(value3).toStrictEqual(testData);

    // Remove the data
    await redis.jsonDel("test", "Test");
  },
  TEST_TIMEOUT,
);

test(
  "JSON.UPDATE",
  async () => {
    await redis.jsonSet("test", "Test", testData);
    const newData: typeof testData = {
      ...testData,
      b: 2,
    };
    await redis.jsonUpdate("test", "Test", newData);
    const value = await redis.jsonGet("test", "Test");
    expect(value).toStrictEqual(newData);
    newData.c = ["test2"];
    await redis.jsonUpdate("test", "Test", newData);
    const value2 = await redis.jsonGet("test", "Test");
    expect(value2).toStrictEqual(newData);
    delete newData.b;
    await redis.jsonUpdate("test", "Test", {
      ...newData,
      b: null,
    });
    const value3 = await redis.jsonGet("test", "Test");
    expect(value3).toStrictEqual(newData);
    // @ts-expect-error Test that it doesn't allow undefined
    newData.a = undefined;
    await redis.jsonUpdate("test", "Test", newData).catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
    });

    // Remove the data
    await redis.jsonDel("test", "Test");
  },
  TEST_TIMEOUT,
);

test(
  "JSON.DEL",
  async () => {
    await redis.jsonSet("test", "Test", testData);
    await redis.jsonDel("test", "Test");
    const value2 = await redis.jsonGet("test", "Test");
    expect(value2).toBe(null);
    await redis.jsonSet("test", "Test", testData);
    await redis.jsonDel("test", "Test", "$.b");
    const value3 = await redis.jsonGet("test", "Test");
    expect(value3?.b).toBe(undefined);

    // Remove the data
    await redis.jsonDel("test", "Test");
  },
  TEST_TIMEOUT,
);
