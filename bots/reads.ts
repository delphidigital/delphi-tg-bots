import { Telegraf } from 'telegraf';

export const readsBot = (_params) => {
  const bot = new Telegraf(process.env.DELPHI_READS_BOT_TOKEN)
  return bot;
}

export default readsBot;
