import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  SLACK_APP_TOKEN: z.string().startsWith("xapp-"),
  SLACK_SIGNING_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().min(1),
  NOTION_TOKEN: z.string().min(1),
  NOTION_DATABASE_ID: z.string().min(1),
  BRIEFING_CHANNEL_ID: z.string().optional(),
  TIMEZONE: z.string().default("UTC"),
});

export type EnvConfig = z.infer<typeof envSchema>;

let config: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (!config) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Environment validation failed: ${parsed.error.format()}`
      );
    }
    config = parsed.data;
  }
  return config;
}
