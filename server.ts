import dotenv from 'dotenv';
import crypto from 'crypto';
import express from 'express';

import { BotConfig, clerkBot } from './bots/delphi-clerk.ts';
import { CalendarBotConfig, calendarBot } from './bots/calendar-bot.ts';
import { mask } from './utils/index.js';
import audit from 'express-requests-logger';
import SmeeClient from 'smee-client';

dotenv.config({ debug: true });

const {
  DELPHI_API_BASE_URL,
  DELPHI_READS_API_KEY,
  DELPHI_AF_API_KEY,
  DELPHI_READS_BOT_TOKEN,
  DELPHI_READS_WEBHOOK_URL,
  DELPHI_READS_READING_LIST_ID,
  OPENAI_API_KEY,
  // Calendar bot env vars
  CALENDAR_BOT_TOKEN,
  CALENDAR_WEBHOOK_URL,
  CALENDAR_API_KEY,
  DEV,
  PORT,
} = process.env;

if (!DELPHI_AF_API_KEY) throw new Error('"DELPHI_AF_API_KEY" env var is required!');
if (!DELPHI_READS_READING_LIST_ID) throw new Error('"DELPHI_READS_READING_LIST_ID" env var is required!');
if (!DELPHI_READS_API_KEY) throw new Error('"DELPHI_READS_API_KEY" env var is required!');
if (!DELPHI_API_BASE_URL) throw new Error('"DELPHI_API_BASE_URL" env var is required!');
if (!DELPHI_READS_BOT_TOKEN) throw new Error('"DELPHI_READS_BOT_TOKEN" env var is required!');
if (!DELPHI_READS_WEBHOOK_URL) throw new Error('"DELPHI_READS_WEBHOOK_URL" env var is required!');
if (!OPENAI_API_KEY) throw new Error('"OPENAI_API_KEY" env var is required!');

// ==================== Clerk Bot (Reads) ====================

const clerkBotConfiguration: BotConfig = {
  botToken: DELPHI_READS_BOT_TOKEN,
  openaiKey: OPENAI_API_KEY,
  delphiApi: {
    mpcCreateReadApiKey: DELPHI_READS_API_KEY,
    mpcCreateAfApiKey: DELPHI_AF_API_KEY,
    baseUrl: DELPHI_API_BASE_URL,
    readingListId: DELPHI_READS_READING_LIST_ID,
  },
};

const readsBot = clerkBot(clerkBotConfiguration);

console.log('Reads Bot Configuration:', {
  DELPHI_API_BASE_URL,
  DELPHI_READS_WEBHOOK_URL,
  DELPHI_READS_BOT_TOKEN: mask(DELPHI_READS_BOT_TOKEN),
  DELPHI_READS_API_KEY: mask(DELPHI_READS_API_KEY),
  DELPHI_AF_API_KEY: mask(DELPHI_AF_API_KEY),
});

// ==================== Calendar Bot ====================

const calendarBotEnabled = !!(CALENDAR_BOT_TOKEN && CALENDAR_WEBHOOK_URL && CALENDAR_API_KEY);
let calBot: ReturnType<typeof calendarBot> | null = null;

if (calendarBotEnabled) {
  const calendarBotConfig: CalendarBotConfig = {
    botToken: CALENDAR_BOT_TOKEN,
    delphiApi: {
      baseUrl: DELPHI_API_BASE_URL,
      calendarApiKey: CALENDAR_API_KEY,
    },
  };

  calBot = calendarBot(calendarBotConfig);

  console.log('Calendar Bot Configuration:', {
    CALENDAR_WEBHOOK_URL,
    CALENDAR_BOT_TOKEN: mask(CALENDAR_BOT_TOKEN),
    CALENDAR_API_KEY: mask(CALENDAR_API_KEY),
  });
} else {
  console.log('Calendar Bot: DISABLED (missing env vars: CALENDAR_BOT_TOKEN, CALENDAR_WEBHOOK_URL, CALENDAR_API_KEY)');
}

// ==================== Express Server ====================

const readsWebhookPath = '/webhooks/reads';
const calendarWebhookPath = '/webhooks/calendar';
let readsBotWebhookUrl = `${DELPHI_READS_WEBHOOK_URL}${readsWebhookPath}`;

const app = express();
const port = PORT || 5555;

if (DEV) {
  readsBotWebhookUrl = DELPHI_READS_WEBHOOK_URL;

  // setup webhook proxy to local server
  const smee = new SmeeClient({
    source: DELPHI_READS_WEBHOOK_URL,
    target: `http://localhost:${port}${readsWebhookPath}`,
    logger: console,
  });

  await smee.start();
}

// log requests
app.use(
  audit({
    request: {
    maskHeaders: ['x-telegram-bot-api-secret-token']
  }
}));

// Reads bot webhook
const readsSecretToken = crypto.randomBytes(64).toString("hex");
app.use(readsBot.webhookCallback(readsWebhookPath, { secretToken: readsSecretToken }));
await readsBot.telegram.setWebhook(readsBotWebhookUrl, { secret_token: readsSecretToken });

// Calendar bot webhook (if enabled)
if (calBot && CALENDAR_WEBHOOK_URL) {
  const calendarSecretToken = crypto.randomBytes(64).toString("hex");
  const calendarBotWebhookUrl = `${CALENDAR_WEBHOOK_URL}${calendarWebhookPath}`;
  app.use(calBot.webhookCallback(calendarWebhookPath, { secretToken: calendarSecretToken }));
  await calBot.telegram.setWebhook(calendarBotWebhookUrl, { secret_token: calendarSecretToken });
  console.log(`Calendar bot webhook registered at ${calendarWebhookPath}`);
}

// configure dev-only endpoints
if (DEV) {
  // for posting reads items to localhost when running locally
  app.post(`/reads`, (req, res) => {
    console.log('POST /reads', req.body);
    res.sendStatus(200);
  });
  // for posting af post data to localhost when running locally
  app.post(`/af`, (req, res) => {
    console.log('POST /af', req.body);
    res.sendStatus(200);
  });
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    bots: {
      reads: true,
      calendar: calendarBotEnabled,
    },
  });
});

// Start Express Server
app.listen(port, () => {
  console.log(`Express server is listening on ${port}`);
  console.log(`Bots active: reads=true, calendar=${calendarBotEnabled}`);
});
