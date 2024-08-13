// override process.env
declare namespace NodeJS {
  interface ProcessEnv {
    DISCORD_TOKEN: string;
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
    SENTRY_DSN: string;
    POSTHOG_KEY: string;
    HEARTBEAT_URL: string;
    REDIS_HOST: string;
    REDIS_PORT: string;
    REDIS_PASSWORD: string;
    DEV?: string;
  }
}
