/* eslint-disable @typescript-eslint/no-unused-vars */
// Extend NodeJS.ProcessEnv interface
namespace NodeJS {
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
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    HOST: string;
    /**
     * Optional Discord webhook URL that bug reports and feature suggestions
     * (the /feedback command) are forwarded to. If unset, feedback is instead
     * DMed to the bot owners listed in `config.owners`.
     */
    FEEDBACK_WEBHOOK_URL?: string;
  }
}
