import { Telegraf, session, Markup, type Context } from 'telegraf';
import type { Update } from 'telegraf/types';

// ==================== Types ====================

type SignalBotState = 'none' | 'await_project' | 'await_text';

interface ProjectListItem {
  slug: string;
  name: string;
  token_symbol: string | null;
  status: string;
}

interface SignalSession {
  state: SignalBotState;
  projectSlug: string;
  projectName: string;
}

interface SignalContext<U extends Update = Update> extends Context<U> {
  session: SignalSession;
}

export interface SignalBotConfig {
  botToken: string;
  pipelineApiUrl: string; // e.g. https://delphi-pipeline.fly.dev/api/v1
  allowedUserIds?: number[]; // restrict to team members (optional)
}

// ==================== Helpers ====================

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>]+/gi;
  return text.match(urlRegex) ?? [];
}

function classifySignal(text: string): { type: string; is_official: boolean } {
  const lower = text.toLowerCase();

  if (/tge|token\s*gen|launch\s*date|mainnet\s*launch|listing\s*date/.test(lower))
    return { type: 'announcement', is_official: /official|confirmed|announced/.test(lower) };
  if (/listed|listing|exchange|binance|coinbase|kraken|bybit/.test(lower))
    return { type: 'listing', is_official: true };
  if (/raise|fund|series|seed|round|investment/.test(lower))
    return { type: 'fundraise', is_official: false };
  if (/tokenomics|supply|allocation|vesting|unlock/.test(lower))
    return { type: 'tokenomics', is_official: false };

  return { type: 'social', is_official: false };
}

function detectDateSignal(text: string): { date_signal?: string; date_precision?: string } {
  // Exact date: "March 20, 2026" or "2026-03-20"
  const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return { date_signal: isoMatch[0], date_precision: 'exact' };

  const monthDayYear = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s*(20\d{2})\b/i);
  if (monthDayYear) {
    const months: Record<string, string> = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12',
    };
    const m = months[monthDayYear[1].toLowerCase()];
    const d = monthDayYear[2].padStart(2, '0');
    return { date_signal: `${monthDayYear[3]}-${m}-${d}`, date_precision: 'exact' };
  }

  // Quarter: "Q2 2026"
  const quarterMatch = text.match(/\bQ([1-4])\s*(20\d{2})\b/i);
  if (quarterMatch) {
    const qMonth = { '1': '01', '2': '04', '3': '07', '4': '10' }[quarterMatch[1]]!;
    return { date_signal: `${quarterMatch[2]}-${qMonth}-01`, date_precision: 'quarter' };
  }

  // Month: "March 2026"
  const monthYear = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (monthYear) {
    const months: Record<string, string> = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12',
    };
    const m = months[monthYear[1].toLowerCase()];
    return { date_signal: `${monthYear[2]}-${m}-01`, date_precision: 'month' };
  }

  return {};
}

// ==================== API Functions ====================

async function fetchProjects(config: SignalBotConfig): Promise<ProjectListItem[]> {
  try {
    const res = await fetch(`${config.pipelineApiUrl}/projects?limit=100`);
    if (!res.ok) return [];
    const data = (await res.json()) as { projects: ProjectListItem[] };
    return data.projects ?? [];
  } catch {
    return [];
  }
}

async function searchProject(config: SignalBotConfig, query: string): Promise<ProjectListItem[]> {
  try {
    const res = await fetch(`${config.pipelineApiUrl}/projects?search=${encodeURIComponent(query)}&limit=10`);
    if (!res.ok) return [];
    const data = (await res.json()) as { projects: ProjectListItem[] };
    return data.projects ?? [];
  } catch {
    return [];
  }
}

async function createSignal(
  config: SignalBotConfig,
  slug: string,
  signal: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${config.pipelineApiUrl}/projects/${slug}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signal),
    });
    if (res.ok) return { ok: true };
    const body = await res.text();
    return { ok: false, error: `${res.status}: ${body}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ==================== Bot Factory ====================

export function signalBot(config: SignalBotConfig): Telegraf<SignalContext> {
  const bot = new Telegraf<SignalContext>(config.botToken);

  bot.use(session());

  bot.use((ctx, next) => {
    ctx.session ??= { state: 'none', projectSlug: '', projectName: '' };
    return next();
  });

  // Optional: restrict to allowed users
  if (config.allowedUserIds?.length) {
    bot.use((ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId || !config.allowedUserIds!.includes(userId)) {
        return ctx.reply('Not authorized.');
      }
      return next();
    });
  }

  // ── /start ──

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '<b>Delphi Signal Bot</b>\n\n' +
      'Submit TGE signals from Discord, Twitter, or anywhere.\n\n' +
      '<b>Quick signal:</b>\n' +
      '<code>/signal arcium TGE confirmed for Q2 2026 https://discord.com/...</code>\n\n' +
      '<b>Commands:</b>\n' +
      '/signal [project] [text] - Submit a signal (one-liner)\n' +
      '/submit - Guided signal submission\n' +
      '/projects - List tracked projects\n' +
      '/cancel - Cancel current operation',
      { parse_mode: 'HTML' }
    );
  });

  // ── /projects ──

  bot.command('projects', async (ctx) => {
    const projects = await fetchProjects(config);
    if (projects.length === 0) {
      await ctx.reply('No projects found.');
      return;
    }

    const byStatus: Record<string, ProjectListItem[]> = {};
    for (const p of projects) {
      (byStatus[p.status] ??= []).push(p);
    }

    let msg = '<b>Tracked Projects</b>\n\n';
    const statusOrder = ['approaching', 'tracking', 'launched'];
    for (const status of statusOrder) {
      const group = byStatus[status];
      if (!group?.length) continue;
      const label = status === 'approaching' ? '🔥 Approaching' : status === 'tracking' ? '📡 Tracking' : '✅ Launched';
      msg += `${label}\n`;
      for (const p of group) {
        const symbol = p.token_symbol ? ` ($${escapeHtml(p.token_symbol)})` : '';
        msg += `  <code>${escapeHtml(p.slug)}</code> — ${escapeHtml(p.name)}${symbol}\n`;
      }
      msg += '\n';
    }

    msg += 'Use the <code>slug</code> in /signal commands.';
    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  // ── /signal (one-liner) ──

  bot.command('signal', async (ctx) => {
    const text = ctx.message.text.replace(/^\/signal\s*/i, '').trim();

    if (!text) {
      await ctx.reply(
        'Usage: <code>/signal [project-slug] [signal text + optional URL]</code>\n\n' +
        'Example:\n<code>/signal arcium TGE confirmed for Q2 2026 https://discord.com/...</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // First word = project slug guess
    const parts = text.split(/\s+/);
    const slugGuess = parts[0].toLowerCase();
    const signalText = parts.slice(1).join(' ');

    if (!signalText) {
      await ctx.reply('Please include the signal text after the project slug.');
      return;
    }

    // Try exact match first, then fuzzy search
    let matches = await searchProject(config, slugGuess);
    let project = matches.find(p => p.slug === slugGuess || p.name.toLowerCase() === slugGuess);

    if (!project && matches.length === 1) {
      project = matches[0];
    }

    if (!project) {
      // Show suggestions
      if (matches.length > 1) {
        const buttons = matches.slice(0, 5).map(p => [
          Markup.button.callback(`${p.name} (${p.slug})`, `pick_${p.slug}`)
        ]);
        // Stash the signal text in session for when they pick
        ctx.session.state = 'await_project';
        ctx.session.projectSlug = signalText; // reuse field to stash pending text
        await ctx.reply(
          `Multiple matches for "<b>${escapeHtml(slugGuess)}</b>". Pick one:`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
        );
        return;
      }

      await ctx.reply(
        `Project "<b>${escapeHtml(slugGuess)}</b>" not found.\n` +
        'Use /projects to see tracked projects.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Submit the signal
    await submitSignal(ctx, config, project.slug, project.name, signalText);
  });

  // ── /submit (guided) ──

  bot.command('submit', async (ctx) => {
    ctx.session.state = 'await_project';
    ctx.session.projectSlug = '';
    ctx.session.projectName = '';

    await ctx.reply(
      'Which project? Type the name or slug:',
      { parse_mode: 'HTML' }
    );
  });

  // ── /cancel ──

  bot.command('cancel', async (ctx) => {
    ctx.session.state = 'none';
    ctx.session.projectSlug = '';
    await ctx.reply('Cancelled.');
  });

  // ── Callback query handler ──

  bot.on('callback_query', async (ctx) => {
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data) return;
    await ctx.answerCbQuery();

    if (data.startsWith('pick_')) {
      const slug = data.replace('pick_', '');
      const pendingText = ctx.session.projectSlug; // stashed signal text

      if (pendingText && ctx.session.state === 'await_project') {
        // We had a pending one-liner signal
        const projects = await searchProject(config, slug);
        const project = projects.find(p => p.slug === slug);
        if (project) {
          await submitSignal(ctx, config, project.slug, project.name, pendingText);
          ctx.session.state = 'none';
          ctx.session.projectSlug = '';
          return;
        }
      }

      // Guided flow: project selected, now ask for text
      ctx.session.projectSlug = slug;
      const projects = await searchProject(config, slug);
      ctx.session.projectName = projects.find(p => p.slug === slug)?.name ?? slug;
      ctx.session.state = 'await_text';
      await ctx.reply(
        `Selected: <b>${escapeHtml(ctx.session.projectName)}</b>\n\n` +
        'Paste the signal (text + URL):',
        { parse_mode: 'HTML' }
      );
    }
  });

  // ── Text handler ──

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const { state } = ctx.session;

    if (state === 'none') return;

    if (state === 'await_project') {
      const matches = await searchProject(config, text);

      if (matches.length === 0) {
        await ctx.reply(
          `No project matching "<b>${escapeHtml(text)}</b>". Try again or /projects to list all.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (matches.length === 1) {
        ctx.session.projectSlug = matches[0].slug;
        ctx.session.projectName = matches[0].name;
        ctx.session.state = 'await_text';
        await ctx.reply(
          `Selected: <b>${escapeHtml(matches[0].name)}</b>\n\nPaste the signal (text + URL):`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const buttons = matches.slice(0, 5).map(p => [
        Markup.button.callback(`${p.name} (${p.slug})`, `pick_${p.slug}`)
      ]);
      await ctx.reply('Pick the project:', Markup.inlineKeyboard(buttons));
      return;
    }

    if (state === 'await_text') {
      await submitSignal(ctx, config, ctx.session.projectSlug, ctx.session.projectName, text);
      ctx.session.state = 'none';
      ctx.session.projectSlug = '';
      ctx.session.projectName = '';
    }
  });

  return bot;
}

// ==================== Signal Submission ====================

async function submitSignal(
  ctx: SignalContext,
  config: SignalBotConfig,
  slug: string,
  projectName: string,
  text: string
): Promise<void> {
  const urls = extractUrls(text);
  const url = urls[0] ?? null;
  const { type, is_official } = classifySignal(text);
  const { date_signal, date_precision } = detectDateSignal(text);
  const username = ctx.from?.username ?? ctx.from?.first_name ?? 'unknown';

  // Determine source from URL
  let source = 'manual';
  if (url) {
    if (url.includes('discord.com') || url.includes('discord.gg')) source = 'discord';
    else if (url.includes('twitter.com') || url.includes('x.com')) source = 'twitter';
    else if (url.includes('t.me') || url.includes('telegram')) source = 'telegram';
    else source = 'web';
  }

  const signal = {
    title: text.length > 200 ? text.substring(0, 197) + '...' : text,
    body: text.length > 200 ? text : undefined,
    type,
    source,
    url,
    author: `tg:${username}`,
    is_official,
    relevance: is_official ? 80 : 60,
    ...(date_signal && { date_signal }),
    ...(date_precision && { date_precision }),
  };

  const result = await createSignal(config, slug, signal);

  if (result.ok) {
    let msg = `✅ Signal added to <b>${escapeHtml(projectName)}</b>\n`;
    msg += `Type: ${type} | Source: ${source}`;
    if (date_signal) msg += `\nDate detected: ${date_signal} (${date_precision})`;
    if (is_official) msg += '\n⚡ Marked as official';
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } else {
    await ctx.reply(`❌ Failed: ${result.error}`);
  }
}
