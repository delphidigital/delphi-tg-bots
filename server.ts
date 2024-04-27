import dotenv from 'dotenv';
import crypto from 'crypto';
import express from 'express';
import { ReadsConfig, readsBot, Sector } from './bots/reads.js';
import audit from 'express-requests-logger';
import SmeeClient from 'smee-client';

dotenv.config({ debug: true });

const {
  DELPHI_API_BASE_URL,
  DELPHI_READS_BOT_TOKEN,
  DELPHI_READS_WEBHOOK_URL,
  DEV,
  PORT,
} = process.env;

if (!DELPHI_API_BASE_URL) throw new Error('"DELPHI_API_BASE_URL" env var is required!');
if (!DELPHI_READS_BOT_TOKEN) throw new Error('"DELPHI_READS_BOT_TOKEN" env var is required!');
if (!DELPHI_READS_WEBHOOK_URL) throw new Error('"DELPHI_READS_WEBHOOK_URL" env var is required!');

const sectors: Sector[] = [
  { slug: 'general', title: 'General' },
  { slug: 'finance', title: 'DeFi' },
  { slug: 'infrastructure', title: 'Infrastructure' },
  { slug: 'macro-markets', title: 'Macro & Markets' },
  { slug: 'metaverse', title: 'NFTs & Gaming' },
];

const readsBotConfiguration: ReadsConfig = {
  botToken: DELPHI_READS_BOT_TOKEN,
  delphiApi: {
    baseUrl: DELPHI_API_BASE_URL,
  },
  sectors,
};

const bot = readsBot(readsBotConfiguration);

console.log('Configuration:', {
  DELPHI_API_BASE_URL,
  DELPHI_READS_WEBHOOK_URL,
  DELPHI_READS_BOT_TOKEN: DELPHI_READS_BOT_TOKEN.replaceAll(/./g, '*'),
});

const readsWebhookPath = '/webhooks/reads';

const app = express();
const port = PORT || 5555;

if (DEV) {
  // setup webhook proxy to local server
  const smee = new SmeeClient({
    source: DELPHI_READS_WEBHOOK_URL,
    target: `http://localhost:${port}${readsWebhookPath}`,
    logger: console,
  });

  await smee.start();
}

// log requests
app.use(audit({
  request: {
    maskHeaders: ['x-telegram-bot-api-secret-token']
  }
}));

// use this instead of createWebhook() so we can easily proxy thru smee locally
const secretToken = crypto.randomBytes(64).toString("hex");
app.use(bot.webhookCallback(readsWebhookPath, { secretToken }));
await bot.telegram.setWebhook(DELPHI_READS_WEBHOOK_URL, { secret_token: secretToken });

// configure dev-only endpoints
if (DEV) {
  // for posting reads items to localhost when running locally
  app.post(`/reads`, (req, res) => {
    console.log('POST /reads', req.body);
    res.sendStatus(200);
  });
}

// Start Express Server
app.listen(port, () => {
  console.log(`Express server is listening on ${port}`);
});
