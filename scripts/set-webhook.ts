/**
 * Registers the Telegram webhook, bot commands, and the bot's name and description.
 *
 *   pnpm set-webhook https://your-app.vercel.app   # or an ngrok URL
 *   pnpm set-webhook --info
 *   pnpm set-webhook --delete
 */
import { config } from "dotenv";
import { TelegramClient } from "../packages/shared/src/telegram/client";
import { AGENT_NAME } from "../packages/shared/src/types";

config({ quiet: true });

const WEBHOOK_PATH = "/api/telegram/webhook";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} (set it in .env or the environment)`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const telegram = new TelegramClient(required("TELEGRAM_BOT_TOKEN"));
  const arg = process.argv[2];

  if (!arg || arg === "--help") {
    console.log("Usage: pnpm set-webhook <public-base-url> | --info | --delete");
    process.exit(arg ? 0 : 1);
  }

  if (arg === "--info") {
    console.log(JSON.stringify(await telegram.getWebhookInfo(), null, 2));
    return;
  }

  if (arg === "--delete") {
    await telegram.deleteWebhook();
    console.log("Webhook deleted.");
    return;
  }

  const base = arg.replace(/\/+$/, "");
  if (!base.startsWith("https://")) {
    console.error("Telegram requires an https:// URL (use ngrok/cloudflared locally).");
    process.exit(1);
  }
  const url = base.endsWith(WEBHOOK_PATH) ? base : `${base}${WEBHOOK_PATH}`;

  await telegram.setWebhook({
    url,
    secret_token: required("TELEGRAM_WEBHOOK_SECRET"),
    allowed_updates: ["message", "callback_query"],
    max_connections: 40,
  });
  await telegram.setMyCommands([
    { command: "tasks", description: "Show your latest tasks" },
    { command: "dashboard", description: "Open the live dashboard" },
    { command: "help", description: `What ${AGENT_NAME} can do` },
  ]);
  await telegram.setMyName(AGENT_NAME);
  await telegram.setMyShortDescription(
    `${AGENT_NAME}, your AI task assistant: text or voice in, tasks out.`,
  );
  await telegram.setMyDescription(
    `Hi, I'm ${AGENT_NAME}! Send me a text or voice message and I'll turn it into a task. ` +
      `You can also ask me to change or delete tasks, e.g. "put task 5 in progress". ` +
      `I always show you my plan first and only act after you press Confirm.`,
  );

  const me = await telegram.getMe();
  console.log(`Webhook set for @${me.username}: ${url}`);
  console.log(JSON.stringify(await telegram.getWebhookInfo(), null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
