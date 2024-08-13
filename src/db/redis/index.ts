import { PomeloRedis } from "./json.js";

const redis = new PomeloRedis({
  port: parseInt(process.env.REDIS_PORT),
  host: process.env.REDIS_HOST,
  username: "default",
  password: process.env.REDIS_PASSWORD,
  db: 0,
});

export default redis;
