import express from 'express';
import { readsBot } from './bots/reads.js';

const app = express();
const port = process.env.DELPHI_READS_BOT_PORT;

const readsBotConfiguration = {};
const bot = readsBot(readsBotConfiguration);

app.post(`/reads`, (req, res) => {
  console.log('POST /reads');
  res.sendStatus(200);
});

// bot.launch();

// Start Express Server
app.listen(port, () => {
  console.log(`Express server is listening on ${port}`);
});
