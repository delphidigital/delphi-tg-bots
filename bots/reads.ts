import { Telegraf, session, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Update } from 'telegraf/types';
import Markup from 'telegraf/markup';

type ReadsState = 'await_description' | 'await_title' | 'await_url' | 'build' | 'none';

interface DelphiApi {
  baseUrl: string;
}

export interface ReadsConfig {
  delphiApi: DelphiApi;
  botToken: string;
  sectors: Option[];
  types: Option[];
}

export interface Option {
  slug: string;
  title: string;
}

interface ReadsItem {
  title: string;
  link: string;
  description: string;
  image_url: string;
  taxonomy: string[];
  tags: string[];
}

interface ReadsSession {
  state: ReadsState;
  item: ReadsItem;
}

interface ReadsContext<U extends Update = Update> extends Context<U> {
  session: ReadsSession;
}

interface UrlMetadata {
  title?: string;
  description?: string;
  image?: string;
}

const createNewItem = (): ReadsItem => ({
  title: '',
  link: '',
  description: '',
  image_url: '',
  taxonomy: [],
  tags: [],
});

const createDefaultSession = (): ReadsSession => ({
  state: 'none',
  item: createNewItem(),
});

/*
 * 
 * Utils
 *
 */

const previewText = ({ item }: ReadsSession): string => {
  return `here is what we've got so far:

Title: 
${item.title}

Description: 
${item.description}

Sector: ${item.taxonomy[0] || ''}
Type: ${item.tags[0] || ''}

Image: ${item.image_url}
`;
};

const getOptionLabel = (options: Option[], option: string) => {
  return options.find(({ slug }) => slug === option).title;
}

const normalizeUrl = (url: string) => {
  let cleanUrl = url;

  if (!cleanUrl.startsWith('http')) {
    cleanUrl = `https://${cleanUrl}`;
  }

  // enforce https
  cleanUrl = cleanUrl.replace('http://', 'https://');

  // normalize twitter links
  cleanUrl = cleanUrl.replace('twitter.com', 'x.com');

  // remove query params from x.com links
  if (cleanUrl.includes('x.com')) {
    const u = new URL(cleanUrl);
    cleanUrl = u.origin + u.pathname;
  }

  return cleanUrl;
};

const delphiApiUrl = (path: string, config: ReadsConfig) => {
  return `${config.delphiApi.baseUrl}${path}`
};

const fetchUrlMetadata = async (url: string, config: ReadsConfig): Promise<UrlMetadata> => {
  const metadataUrl = delphiApiUrl(`/api/v1/reads/link-metadata?url=${url}`, config);
  console.log(`fetching metadata for ${url} from ${metadataUrl}`);
  const res = await fetch(metadataUrl);
  if (res.status === 200) {
    return res.json() as UrlMetadata;
  } else {
    console.log(`received ${res.status} fetching url metadata for ${url}`);
    throw new Error('fetch url metadata error');
  }
};

const ensureLinkSet = async (ctx: ReadsContext, callback: Function) => {
  if (!ctx.session.item.link) {
    await ctx.reply('send me a link first');
    return;
  }

  await callback();
};

/*
 *
 * Telegram Helpers
 *
 */

const replyWithPreview = async (ctx: ReadsContext) => {
  // await ctx.reply(previewText(ctx.session), { parse_mode: 'Markdown' });
  await ctx.reply(previewText(ctx.session));
  await displayMenu(ctx);
};

const displayMenu = async (ctx: ReadsContext) => {
  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.callback('Set Title', 'settitle'),
      Markup.button.callback('Set Description', 'setdescription')
    ],
    [
      Markup.button.callback('Set Type', 'settype'),
      Markup.button.callback('Set Sector', 'setsector')
    ],
    [
      Markup.button.callback('Start Over', 'new'),
      Markup.button.callback('Post It!', 'post')
    ],
  ]);
  await ctx.reply('What would you like to do?', buttons);
};

const displayOptionMenu = async (ctx: ReadsContext, options: Option[], command: string, option: string) => {
  const buttonRows = [];
  for (let i = 0; i < options.length; i+= 2) {
    const chunk = options.slice(i, i + 2);
    const optionRowButtons = chunk.map(({ slug, title }) => Markup.button.callback(title, `${command}_${slug}`));
    buttonRows.push(optionRowButtons);
  }
  const buttons = Markup.inlineKeyboard(buttonRows);
  await ctx.reply(`Select a ${option}: `, buttons);
};

const returnToBuildStateAndRenderPreview = async (ctx: ReadsContext) => {
  ctx.session.state = 'build';
  await replyWithPreview(ctx);
};

const resetState = (ctx: ReadsContext) => {
  ctx.session.state = 'none';
  ctx.session.item = createNewItem();
};

/*
 *
 * handlers
 *
 */

const handleNew = async (ctx: ReadsContext) => {
  resetState(ctx);
  ctx.session.state = 'await_url';
  await ctx.reply('what url do you want post?');
};

const handlePost = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    await ctx.reply('TODO: implement me');
  });
};

const handleSetDescription = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    ctx.session.state = 'await_description';
    await ctx.reply('what description do you want?');
  });
};

const handleSetOption = async (ctx: ReadsContext, options: Option[], command: string, option: string) => {
  ensureLinkSet(ctx, async () => {
    await displayOptionMenu(ctx, options, command, option);
  });
};

const handleSetTitle = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    ctx.session.state = 'await_title';
    await ctx.reply('what title do you want?');
  });
};

/*
 *
 * Update Handlers
 *
 */

const handleUpdateDescription = async (description: string, ctx: ReadsContext) => {
  if (description.length > 500) {
    await ctx.reply('sorry, that description too long');
    await handleSetDescription(ctx);
    return;
  }

  ctx.session.item.description = description;
  await returnToBuildStateAndRenderPreview(ctx);
};

const handleUpdateTitle = async (title: string, ctx: ReadsContext) => {
  ctx.session.item.title = title;
  await returnToBuildStateAndRenderPreview(ctx);
};

const handleUpdateUrl = async (url: string, ctx: ReadsContext, config: ReadsConfig) => {
  resetState(ctx);

  await ctx.reply('fetching that url, hang on a sec...');

  const cleanUrl = normalizeUrl(url);
  let metadata: UrlMetadata;

  ctx.session.item.link = cleanUrl;

  try {
    metadata = await fetchUrlMetadata(cleanUrl, config);
  } catch (e) {
    await ctx.reply('sorry, I could not fetch that url');
    await handleNew(ctx);
    return;
  }

  const { description, image, title } = metadata;

  if (!cleanUrl.includes('x.com')) {
    // not twitter, so save the title
    ctx.session.item.title = title || '';
  }

  ctx.session.item.description
    = (description && description.length > 500)
      ? description.substring(0, 497) + '...'
      : description || '';

  ctx.session.item.image_url = image || '';
  ctx.session.state = 'build';

  await replyWithPreview(ctx);
};

/*
 *
 * Bot Setup
 *
 *
 */
export const readsBot = (config: ReadsConfig) => {
  const { botToken, sectors } = config;

  const bot = new Telegraf<ReadsContext>(botToken);

  // setup session
  bot.use(session({ defaultSession: createDefaultSession }));

  // commands
  bot.command('new', handleNew);
  bot.command('post', handlePost);
  bot.command('preview', replyWithPreview);
  bot.command('setdescription', handleSetDescription);
  bot.command('settitle', handleSetTitle);
  bot.command('settype', async (ctx) => { await handleSetOption(ctx, config.types, 'settype', 'type') });
  bot.command('setsector', async (ctx) => { await handleSetOption(ctx, config.sectors, 'setsector', 'sector') });

  // actions
  bot.action('new', handleNew);
  bot.action('post', handlePost);
  bot.action('setdescription', handleSetDescription);
  bot.action('settitle', handleSetTitle);
  bot.action('settype', async (ctx) => { await handleSetOption(ctx, config.types, 'settype', 'type') });
  bot.action('setsector', async (ctx) => { await handleSetOption(ctx, config.sectors, 'setsector', 'sector') });

  // dynamic actions
  bot.action(/setsector_(.+)/, async (ctx) => {
    ctx.session.item.taxonomy = [getOptionLabel(config.sectors, ctx.match[1])];
    await replyWithPreview(ctx);
  })
  bot.action(/settype_(.+)/, async (ctx) => {
    ctx.session.item.tags = [getOptionLabel(config.types, ctx.match[1])];
    await replyWithPreview(ctx);
  })

  bot.hears('state', async (ctx) => {
    await ctx.reply(`\`\`\`\n${JSON.stringify(ctx.session, null, 2)}\n\`\`\``, { parse_mode: 'Markdown' });
  });

  bot.hears(/^https?\:/, async (ctx) => {
    await handleUpdateUrl(ctx.msg.text, ctx, config);
  });

  // message handlers
  bot.on(message('text'), async (ctx) => {
    const { state } = ctx.session;
    const { text } = ctx.msg;

    if (state === 'await_url') {
      await handleUpdateUrl(text, ctx, config);
    }
    else if (state === 'await_description') {
      await handleUpdateDescription(text, ctx);
    }
    else if (state === 'await_title') {
      await handleUpdateTitle(text, ctx);
    }
    else {
      // unknown message. see if it's a url...
      ctx.reply('paste a url to get started');
    }
  });

  return bot;
}
