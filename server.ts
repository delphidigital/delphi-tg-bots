import crypto from 'crypto';
import express from 'express';
import { ReadsConfig, readsBot, Option } from './bots/reads.js';

const {
  DELPHI_API_COOKIE_NAME,
  DELPHI_API_COOKIE_VALUE,
  DELPHI_API_BASE_URL,
  DELPHI_READS_BOT_PORT,
  DELPHI_READS_BOT_TOKEN,
  DELPHI_READS_WEBHOOK_URL
} = process.env;

if (!DELPHI_API_BASE_URL) throw new Error('"DELPHI_API_BASE_URL" env var is required!');
if (!DELPHI_READS_BOT_TOKEN) throw new Error('"DELPHI_READS_BOT_TOKEN" env var is required!');
if (!DELPHI_READS_WEBHOOK_URL) throw new Error('"DELPHI_READS_WEBHOOK_URL" env var is required!');

const app = express();
const port = DELPHI_READS_BOT_PORT || 6000;

const types: Option[] = [
  { slug: 'reads', title: 'Reads' },
  { slug: 'media', title: 'Media' },
  { slug: 'tweets', title: 'Tweets' },
  { slug: 'news', title: 'News' },
  { slug: 'podcast', title: 'Podcast' },
  { slug: 'other', title: 'Other' },
];

const sectors: Option[] = [
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
    cookieName: DELPHI_API_COOKIE_NAME,
    cookieValue: DELPHI_API_COOKIE_VALUE,
  },
  secretToken: crypto.randomBytes(64).toString("hex"),
  sectors,
  types,
  webhookUrl: DELPHI_READS_WEBHOOK_URL,
};

const bot = readsBot(readsBotConfiguration);

app.use(await bot.createWebhook({ domain: DELPHI_READS_WEBHOOK_URL }));

app.post(`/reads`, (req, res) => {
  console.log('POST /reads');
  res.sendStatus(200);
});

// bot.launch();

// Start Express Server
app.listen(port, () => {
  console.log(`Express server is listening on ${port}`);
});
