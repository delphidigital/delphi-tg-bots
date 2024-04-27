import crypto from 'crypto';
import express from 'express';
import { ReadsConfig, readsBot } from './bots/reads.js';

const {
  DELPHI_READS_BOT_PORT,
  DELPHI_READS_BOT_TOKEN,
  DELPHI_READS_WEBHOOK_URL
} = process.env;

if (!DELPHI_READS_BOT_TOKEN) throw new Error('"DELPHI_READS_BOT_TOKEN" env var is required!');
if (!DELPHI_READS_WEBHOOK_URL) throw new Error('"DELPHI_READS_WEBHOOK_URL" env var is required!');

const app = express();
const port = DELPHI_READS_BOT_PORT || 6000;

const readsBotConfiguration: ReadsConfig = {
  botToken: DELPHI_READS_BOT_TOKEN,
  secretToken: crypto.randomBytes(64).toString("hex"),
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
