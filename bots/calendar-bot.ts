import { Telegraf, session, Markup, type Context } from 'telegraf';
import type { Update } from 'telegraf/types';

// ==================== Types ====================

type CalendarBotState =
  | 'none'
  | 'await_name'
  | 'await_date'
  | 'await_time'
  | 'await_end_date'
  | 'await_category'
  | 'await_description'
  | 'await_link'
  | 'confirm';

interface CalendarCategory {
  id: number;
  name: string;
  slug: string;
  color: string;
}

export interface CalendarEventDraft {
  name: string;
  date: string;
  time: string;
  end_date: string;
  category_id: number | null;
  category_name: string;
  description: string;
  link: string;
}

interface CalendarSession {
  state: CalendarBotState;
  event: CalendarEventDraft;
  categories: CalendarCategory[];
}

interface CalendarContext<U extends Update = Update> extends Context<U> {
  session: CalendarSession;
}

export interface CalendarBotConfig {
  botToken: string;
  delphiApi: {
    baseUrl: string;
    calendarApiKey: string;
  };
}

// ==================== Helpers ====================

export const createNewEventDraft = (): CalendarEventDraft => ({
  name: '',
  date: '',
  time: '',
  end_date: '',
  category_id: null,
  category_name: '',
  description: '',
  link: '',
});

export const apiUrl = (path: string, config: CalendarBotConfig) =>
  `${config.delphiApi.baseUrl}${path}`;

const TENANT_HEADER = 'x-tenant-id';
const TENANT = 'delphi';

export const isValidDate = (str: string): boolean => {
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const isValidTime = (str: string): boolean => {
  const match = str.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

export const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00Z');
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

export const formatTime = (timeStr: string): string => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
};

// ==================== API Functions ====================

export async function fetchCategories(config: CalendarBotConfig): Promise<CalendarCategory[] | null> {
  const url = apiUrl('/api/v1/calendar/categories', config);
  try {
    const response = await fetch(url, {
      headers: { [TENANT_HEADER]: TENANT },
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const data = (await response.json()) as { categories: CalendarCategory[] };
    return data.categories || [];
  } catch (error) {
    console.error('Failed to fetch categories:', error);
    return null;
  }
}

interface EventsApiResponse {
  events: CalendarEventResponse[];
  total: number;
}

export interface CalendarEventResponse {
  id: string;
  name: string;
  date: string;
  time: string | null;
  end_date: string | null;
  description: string | null;
  link: string | null;
  category: { name: string; slug: string } | null;
  is_hot?: boolean;
  hot_reason?: string | null;
  hot_source?: string | null;
}

export async function fetchUpcomingEvents(
  config: CalendarBotConfig,
  days: number = 7
): Promise<EventsApiResponse> {
  const today = new Date().toISOString().split('T')[0];
  const endDate = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

  const url = apiUrl(
    `/api/v1/calendar/events?start_date=${today}&end_date=${endDate}&status=published&limit=20`,
    config
  );

  try {
    const response = await fetch(url, {
      headers: { [TENANT_HEADER]: TENANT },
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    return (await response.json()) as EventsApiResponse;
  } catch (error) {
    console.error('Failed to fetch upcoming events:', error);
    return { events: [], total: 0 };
  }
}

export async function fetchHotEvents(
  config: CalendarBotConfig,
  days: number = 7
): Promise<EventsApiResponse> {
  const today = new Date().toISOString().split('T')[0];
  const endDate = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

  // Soft cap on the curator side is 7 (see calendar-web /admin/hot-list);
  // 20 matches /upcoming and gives plenty of headroom while still bounding
  // payload size for very long curator runs.
  const url = apiUrl(
    `/api/v1/calendar/events?start_date=${today}&end_date=${endDate}&status=published&is_hot=true&limit=20`,
    config
  );

  try {
    const response = await fetch(url, {
      headers: { [TENANT_HEADER]: TENANT },
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    return (await response.json()) as EventsApiResponse;
  } catch (error) {
    console.error('Failed to fetch hot events:', error);
    return { events: [], total: 0 };
  }
}

export async function createEvent(
  config: CalendarBotConfig,
  event: CalendarEventDraft,
  tgUsername: string
): Promise<{ ok: boolean; error?: string }> {
  const url = apiUrl('/api/v1/bots/tg/calendar/events', config);

  const body: Record<string, unknown> = {
    event: {
      name: event.name,
      date: event.date,
      category_id: event.category_id,
      tg_username: tgUsername,
      ...(event.time && { time: event.time }),
      ...(event.end_date && { end_date: event.end_date }),
      ...(event.description && { description: event.description }),
      ...(event.link && { link: event.link }),
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TENANT_HEADER]: TENANT,
        Authorization: `Bearer ${config.delphiApi.calendarApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return { ok: true };
    }

    const errorBody = await response.text();
    console.error(`Create event failed (${response.status}):`, errorBody);

    if (response.status === 401) return { ok: false, error: 'Unauthorized. Check API key.' };
    if (response.status === 422) return { ok: false, error: 'Validation error. Please check event details and try again.' };
    return { ok: false, error: `Server error (${response.status})` };
  } catch (error) {
    console.error('Failed to create event:', error);
    return { ok: false, error: 'Network error' };
  }
}

// ==================== Bot Factory ====================

export function calendarBot(config: CalendarBotConfig): Telegraf<CalendarContext> {
  const bot = new Telegraf<CalendarContext>(config.botToken);

  bot.use(session());

  // Ensure session exists
  bot.use((ctx, next) => {
    ctx.session ??= {
      state: 'none',
      event: createNewEventDraft(),
      categories: [],
    };
    return next();
  });

  // ==================== Commands ====================

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '👋 Welcome to the <b>Delphi Calendar Bot</b>!\n\n' +
        'I can help you manage crypto calendar events.\n\n' +
        'Available commands:\n' +
        '/upcoming - View upcoming events (next 7 days)\n' +
        '/hotlist - Preview curator-flagged hot picks\n' +
        '/addevent - Create a new calendar event\n' +
        '/categories - List event categories\n' +
        '/help - Show this help message\n' +
        '/cancel - Cancel current operation',
      { parse_mode: 'HTML' }
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '📅 <b>Delphi Calendar Bot Commands</b>\n\n' +
        '/upcoming - View upcoming events (next 7 days)\n' +
        '/hotlist - Preview curator-flagged hot picks\n' +
        '/addevent - Create a new calendar event\n' +
        '/categories - List event categories\n' +
        '/cancel - Cancel current operation\n' +
        '/help - Show this help message',
      { parse_mode: 'HTML' }
    );
  });

  bot.command('cancel', async (ctx) => {
    ctx.session.state = 'none';
    ctx.session.event = createNewEventDraft();
    await ctx.reply('❌ Operation cancelled.');
  });

  // ==================== /upcoming ====================

  bot.command('upcoming', async (ctx) => {
    await ctx.reply('⏳ Fetching upcoming events...');

    const response = await fetchUpcomingEvents(config);
    const message = formatWeeklyDigest(response);

    // Telegram has a 4096 char limit per message
    if (message.length > 4000) {
      for (const chunk of chunkForTelegram(message)) {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.reply(message, { parse_mode: 'HTML' });
    }
  });

  // ==================== /hotlist ====================
  // Standalone preview of the hot block + feedback prompt. Same content the
  // weekly digest uses, useful for ad-hoc curator/QA checks before the digest
  // sends to the broader Delphi research chat.
  bot.command('hotlist', async (ctx) => {
    await ctx.reply('⏳ Fetching hot events...');

    const { events } = await fetchHotEvents(config);
    const block = formatHotListBlock(events);

    if (!block) {
      await ctx.reply('🔥 No hot events flagged for the next 7 days.');
      return;
    }

    // Chunk under Telegram's 4096-char limit. Attach the feedback keyboard
    // only to the last chunk so the buttons don't appear mid-thread.
    const chunks = chunkForTelegram(`${block}\n\nWas this useful?`);
    for (const [index, chunk] of chunks.entries()) {
      const isLast = index === chunks.length - 1;
      await ctx.reply(chunk, {
        parse_mode: 'HTML',
        ...(isLast ? hotFeedbackKeyboard() : {}),
      });
    }
  });

  // ==================== /categories ====================

  bot.command('categories', async (ctx) => {
    const categories = await fetchCategories(config);

    if (categories === null) {
      await ctx.reply('⚠️ Could not load categories. Please try again later.');
      return;
    }

    if (categories.length === 0) {
      await ctx.reply('No categories found.');
      return;
    }

    let message = '🏷 <b>Calendar Categories</b>\n\n';
    for (const cat of categories) {
      message += `  • <b>${escapeHtml(cat.name)}</b> (${escapeHtml(cat.slug)})\n`;
    }

    await ctx.reply(message, { parse_mode: 'HTML' });
  });

  // ==================== /addevent wizard ====================

  bot.command('addevent', async (ctx) => {
    // Prefetch categories
    const categories = await fetchCategories(config);
    if (!categories || categories.length === 0) {
      await ctx.reply('⚠️ Could not load categories. Please try again later.');
      return;
    }
    ctx.session.categories = categories;

    ctx.session.state = 'await_name';
    ctx.session.event = createNewEventDraft();

    await ctx.reply('📝 <b>Create New Event</b>\n\nStep 1/8: Enter the event name:', {
      parse_mode: 'HTML',
    });
  });

  // ==================== Callback query handler (for inline keyboards) ====================

  bot.on('callback_query', async (ctx) => {
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data) return;

    // Hot-list feedback: structured callback `hot_feedback:<verdict>` so a
    // future Stage 2/3 rollup can grep [hot_feedback] log lines for verdict
    // counts. Phase 1 is block-level (one rating per digest message); per-
    // event scoring will be added when we have engagement signal to tune on.
    if (data.startsWith('hot_feedback:')) {
      const { verdict, eventId, known } = parseHotFeedback(data);
      const username = ctx.callbackQuery.from?.username || ctx.callbackQuery.from?.id || 'unknown';
      const messageId = ctx.callbackQuery.message?.message_id ?? 'unknown';
      const eventTag = eventId ? ` event=${eventId}` : '';

      if (known) {
        console.info(
          `[hot_feedback] user=${username} verdict=${verdict}${eventTag} message_id=${messageId}`
        );
        await ctx.answerCbQuery(
          verdict === 'helpful' ? '🙏 Thanks for the signal!' : 'Got it — we’ll tune the picks.'
        );
      } else {
        // Future-proof: ack but log so we notice if the keyboard format drifts.
        console.warn(
          `[hot_feedback] unknown verdict=${verdict}${eventTag} user=${username} message_id=${messageId}`
        );
        await ctx.answerCbQuery();
      }
      return;
    }

    await ctx.answerCbQuery();

    // Category selection
    if (data.startsWith('cat_')) {
      if (ctx.session.state !== 'await_category') return;

      const catId = parseInt(data.replace('cat_', ''), 10);
      const category = ctx.session.categories.find((c) => c.id === catId);

      if (!category) {
        await ctx.reply('⚠️ Invalid category. Please try again.');
        return;
      }

      ctx.session.event.category_id = category.id;
      ctx.session.event.category_name = category.name;
      ctx.session.state = 'await_description';

      await ctx.reply(
        `✅ Category: <b>${escapeHtml(category.name)}</b>\n\n` +
          'Step 6/8: Enter a description (or send /skip):',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Confirm / Cancel
    if (data === 'confirm_create') {
      if (ctx.session.state !== 'confirm') return;

      const username = ctx.callbackQuery.from.username || 'unknown';
      await ctx.reply('⏳ Creating event...');

      const result = await createEvent(config, ctx.session.event, username);

      if (result.ok) {
        await ctx.reply(
          '✅ <b>Event submitted for review!</b>\n\nAn admin will approve it before it appears on the calendar.',
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(`❌ Failed to create event: ${result.error}`);
      }

      ctx.session.state = 'none';
      ctx.session.event = createNewEventDraft();
      return;
    }

    if (data === 'cancel_create') {
      ctx.session.state = 'none';
      ctx.session.event = createNewEventDraft();
      await ctx.reply('❌ Event creation cancelled.');
      return;
    }
  });

  // ==================== Text message handler (wizard steps) ====================

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const { state } = ctx.session;

    // Ignore if not in a wizard state
    if (state === 'none') return;

    // Handle /skip for optional fields
    const isSkip = text === '/skip';

    switch (state) {
      case 'await_name': {
        if (text.length < 2 || text.length > 500) {
          await ctx.reply('⚠️ Event name must be 2-500 characters. Try again:');
          return;
        }
        ctx.session.event.name = text;
        ctx.session.state = 'await_date';
        await ctx.reply('Step 2/8: Enter the event date (YYYY-MM-DD):');
        break;
      }

      case 'await_date': {
        if (!isValidDate(text)) {
          await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD (e.g., 2026-03-15):');
          return;
        }
        ctx.session.event.date = text;
        ctx.session.state = 'await_time';
        await ctx.reply('Step 3/8: Enter the event time in 24h format (HH:MM) or send /skip:');
        break;
      }

      case 'await_time': {
        if (isSkip) {
          ctx.session.event.time = '';
        } else if (!isValidTime(text)) {
          await ctx.reply('⚠️ Invalid time format. Please use HH:MM (e.g., 14:30) or /skip:');
          return;
        } else {
          ctx.session.event.time = text;
        }
        ctx.session.state = 'await_end_date';
        await ctx.reply('Step 4/8: Enter end date (YYYY-MM-DD) for multi-day events, or /skip:');
        break;
      }

      case 'await_end_date': {
        if (isSkip) {
          ctx.session.event.end_date = '';
        } else if (!isValidDate(text)) {
          await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD or /skip:');
          return;
        } else if (text < ctx.session.event.date) {
          await ctx.reply('⚠️ End date must be on or after the start date. Try again:');
          return;
        } else {
          ctx.session.event.end_date = text;
        }

        // Show category selection keyboard
        ctx.session.state = 'await_category';
        const buttons = ctx.session.categories.map((cat) => [
          Markup.button.callback(cat.name, `cat_${cat.id}`),
        ]);
        await ctx.reply('Step 5/8: Select a category:', Markup.inlineKeyboard(buttons));
        break;
      }

      case 'await_description': {
        ctx.session.event.description = isSkip ? '' : text;
        ctx.session.state = 'await_link';
        await ctx.reply('Step 7/8: Enter a URL link (or send /skip):');
        break;
      }

      case 'await_link': {
        if (isSkip) {
          ctx.session.event.link = '';
        } else {
          // Basic URL validation
          try {
            const parsed = new URL(text);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
              await ctx.reply('⚠️ Only http/https URLs are allowed. Try again or /skip:');
              return;
            }
            ctx.session.event.link = text;
          } catch {
            await ctx.reply('⚠️ Invalid URL. Please enter a valid URL or /skip:');
            return;
          }
        }

        // Show preview and confirm
        ctx.session.state = 'confirm';
        const { event } = ctx.session;
        const timeStr = event.time ? ` at ${formatTime(event.time)}` : '';
        const endStr = event.end_date ? ` – ${formatDate(event.end_date)}` : '';
        const descStr = event.description ? `\n📝 ${escapeHtml(event.description)}` : '';
        const linkStr = event.link ? `\n🔗 ${escapeHtml(event.link)}` : '';

        const preview =
          '📋 <b>Event Preview</b>\n━━━━━━━━━━━━━━━━━━━\n' +
          `📅 <b>${escapeHtml(event.name)}</b>\n` +
          `📆 ${formatDate(event.date)}${endStr}${timeStr}\n` +
          `🏷 ${escapeHtml(event.category_name)}` +
          descStr +
          linkStr +
          '\n━━━━━━━━━━━━━━━━━━━\n' +
          'Step 8/8: Confirm creation?';

        await ctx.reply(
          preview,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Create', 'confirm_create'),
                Markup.button.callback('❌ Cancel', 'cancel_create'),
              ],
            ]),
          }
        );
        break;
      }

      case 'await_category':
        await ctx.reply('⚠️ Please use the buttons above to select a category, or /cancel to start over.');
        break;

      case 'confirm':
        await ctx.reply('⚠️ Please use the buttons above to confirm or cancel, or /cancel to start over.');
        break;

      default:
        break;
    }
  });

  return bot;
}

// ==================== Utility ====================

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ==================== Hot list (Phase 1) ====================

/**
 * Format the hot-list block that sits at the top of the weekly digest and
 * the /hotlist command response. Returns null when there's nothing to show
 * so callers can skip the section without leaving stray headers.
 */
export function formatHotListBlock(events: CalendarEventResponse[]): string | null {
  const hot = events.filter(e => e.is_hot);
  if (hot.length === 0) return null;

  const lines = ['🔥 <b>Hot this week</b>'];
  for (const event of hot) {
    const time = event.time ? ` · ${formatTime(event.time)}` : '';
    const reason = event.hot_reason ? ` — ${escapeHtml(event.hot_reason)}` : '';
    lines.push(
      `• <b>${escapeHtml(event.name)}</b> (${formatDate(event.date)}${time})${reason}`
    );
  }
  return lines.join('\n');
}

/**
 * Build the full weekly digest message: hot block + standard upcoming list.
 * Pure function over the API response so it's easy to unit-test without a
 * Telegram client.
 */
export function formatWeeklyDigest(response: EventsApiResponse): string {
  const { events, total } = response;
  const hotBlock = formatHotListBlock(events);

  if (events.length === 0) {
    return '📅 No upcoming events in the next 7 days.';
  }

  const sections: string[] = [];
  if (hotBlock) {
    sections.push(hotBlock);
    sections.push('━━━━━━━━━━━━━━━━━━━');
  }

  sections.push('📅 <b>Upcoming Events (Next 7 Days)</b>');
  sections.push('━━━━━━━━━━━━━━━━━━━');

  for (const event of events) {
    const category = event.category?.name || 'Uncategorized';
    const time = event.time ? ` • ${formatTime(event.time)}` : '';
    const endDate = event.end_date && event.end_date !== event.date
      ? ` – ${formatDate(event.end_date)}`
      : '';
    const link = event.link ? `\n   🔗 ${escapeHtml(event.link)}` : '';
    const flame = event.is_hot ? '🔥 ' : '';

    sections.push(
      `\n${flame}📌 <b>${escapeHtml(event.name)}</b>\n` +
        `   ${formatDate(event.date)}${endDate}${time}\n` +
        `   🏷 ${escapeHtml(category)}${link}`
    );
  }

  const shown = events.length;
  const footer = shown < total
    ? `📊 Showing ${shown} of ${total} events`
    : `📊 ${total} event${total === 1 ? '' : 's'} total`;
  sections.push('\n━━━━━━━━━━━━━━━━━━━');
  sections.push(footer);

  return sections.join('\n');
}

/**
 * Parse the `hot_feedback:<verdict>[:<event_id>]` callback payload. The
 * keyboard today emits just `<verdict>`; a future iteration may suffix
 * `<event_id>` for per-event scoring. Splitting here keeps the callback
 * handler stable across that change.
 */
export type HotFeedbackPayload = {
  verdict: string;
  eventId?: string;
  known: boolean;
};

export function parseHotFeedback(data: string): HotFeedbackPayload {
  const prefix = 'hot_feedback:';
  if (!data.startsWith(prefix)) {
    return { verdict: '', known: false };
  }
  const [verdict, eventId] = data.slice(prefix.length).split(':');
  const known = verdict === 'helpful' || verdict === 'not_useful';
  return { verdict, eventId, known };
}

/**
 * Inline keyboard prompting digest readers to react. Callback data is
 * `hot_feedback:helpful` / `hot_feedback:not_useful` — the prefix lets the
 * callback handler dispatch generically and lets future iterations append
 * an event id (`hot_feedback:<verdict>:<event_id>`) without a breaking
 * change.
 */
export function hotFeedbackKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('👍 Helpful', 'hot_feedback:helpful'),
      Markup.button.callback('👎 Not useful', 'hot_feedback:not_useful'),
    ],
  ]);
}

/**
 * Telegram has a 4096-char limit per message. Split a long message on
 * newlines first (preserves formatting), then hard-split any single line
 * longer than `maxLen` on character boundaries as a fallback.
 *
 * Contract: `chunks.join('\n') === message` for any input where no single
 * line exceeds `maxLen`. (When hard-splitting fires, that contract relaxes
 * — but our digest lines come from validated event fields ≤500 chars, so
 * the fallback only fires on pathological input.)
 *
 * Uses `null` to distinguish "no current chunk yet" from "current chunk is
 * an empty string", so leading/boundary blank lines round-trip correctly.
 */
export function chunkForTelegram(message: string, maxLen = 4000): string[] {
  if (message.length <= maxLen) return [message];

  const chunks: string[] = [];
  let current: string | null = null;

  const flush = () => {
    if (current !== null) {
      chunks.push(current);
      current = null;
    }
  };

  for (const line of message.split('\n')) {
    if (line.length > maxLen) {
      // Single line longer than the limit — flush whatever's pending, then
      // hard-split the line into bounded pieces.
      flush();
      for (let i = 0; i < line.length; i += maxLen) {
        chunks.push(line.slice(i, i + maxLen));
      }
      continue;
    }

    const candidate = current === null ? line : current + '\n' + line;
    if (candidate.length > maxLen) {
      flush();
      current = line;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}
