/**
 * Standalone test script for the calendar bot.
 * Runs the calendar bot in polling mode without the reads bot.
 *
 * Usage: DEV=1 npx tsx test-calendar-bot.ts
 */

import dotenv from 'dotenv';
import { CalendarBotConfig, calendarBot } from './bots/calendar-bot.ts';

dotenv.config();

const CALENDAR_BOT_TOKEN = process.env.CALENDAR_BOT_TOKEN;
const CALENDAR_API_KEY = process.env.CALENDAR_API_KEY;
const DELPHI_API_BASE_URL = process.env.DELPHI_API_BASE_URL || 'http://localhost:4000';

if (!CALENDAR_BOT_TOKEN) throw new Error('"CALENDAR_BOT_TOKEN" env var is required!');
if (!CALENDAR_API_KEY) throw new Error('"CALENDAR_API_KEY" env var is required!');

const config: CalendarBotConfig = {
  botToken: CALENDAR_BOT_TOKEN,
  delphiApi: {
    baseUrl: DELPHI_API_BASE_URL,
    calendarApiKey: CALENDAR_API_KEY,
  },
};

console.log('Starting Calendar Bot in polling mode...');
console.log(`  API: ${DELPHI_API_BASE_URL}`);
console.log('  Token: [redacted]');

const bot = calendarBot(config);

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

await bot.launch();
console.log('Calendar Bot is running! Send /start to @DelphiCalendarBetaBot on Telegram.');
