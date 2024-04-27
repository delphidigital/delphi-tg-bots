import { Telegraf, session, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Update } from 'telegraf/types';
import Markup from 'telegraf/markup';

type ReadsState = 'await_title' | 'await_url' | 'build' | 'none';

interface DelphiApi {
  baseUrl: string;
  cookieName?: string;
  cookieValue?: string;
}

export interface ReadsConfig {
  delphiApi: DelphiApi;
  botToken: string;
  secretToken: string;
  webhookUrl: string;
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

/*
 *
 * handlers
 *
 */

const handleNew = async (ctx: ReadsContext) => {
  ctx.session.item = createNewItem();
  ctx.session.state = 'await_url';
  await ctx.reply('What url do you want post?');
};

const handlePost = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    await ctx.reply('TODO: implement me');
  });
};

const handleSetDescription = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    await ctx.reply('TODO: implement me');
  });
};

const handleSetTaxonomy = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    await ctx.reply('TODO: implement me');
  });
};

const handleSetTitle = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    ctx.session.state = 'await_title';
    await ctx.reply('What title do you want?');
  });
};

const handleSetTag = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    await ctx.reply('TODO: implement me');
  });
};

const handleUrl = async (url: string, ctx: ReadsContext, config: ReadsConfig) => {
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

  if (!cleanUrl.includes('x.com')) {
    // not twitter, so save the title
    ctx.session.item.title = metadata.title || '';
  }

  ctx.session.item.description = metadata.description || '';
  ctx.session.item.image_url = metadata.image || '';
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
  const { botToken, secretToken: _, webhookUrl: _webhookUrlStr } = config;
  // const webhookUrl = new URL(webhookUrlStr);

  const bot = new Telegraf<ReadsContext>(botToken);

  // setup session
  bot.use(session({ defaultSession: createDefaultSession }))

  // commands
  bot.command('new', handleNew);
  bot.command('post', handlePost);
  bot.command('preview', replyWithPreview);
  bot.command('setdescription', handleSetDescription);
  bot.command('setsector', handleSetTaxonomy);
  bot.command('settitle', handleSetTitle);
  bot.command('settype', handleSetTag);

  // actions
  bot.action('new', handleNew);
  bot.action('post', handlePost);
  bot.action('setdescription', handleSetDescription);
  bot.action('setsector', handleSetTaxonomy);
  bot.action('settitle', handleSetTitle);
  bot.action('settype', handleSetTag);

  // message handlers
  bot.on(message('text'), async (ctx) => {
    const { state } = ctx.session;
    const { text } = ctx.msg;

    if (state === 'await_url') {
      await handleUrl(text, ctx, config);
    }
    else if (state === 'await_title') {
      ctx.session.item.title = ctx.msg.text;
      ctx.session.state = 'build';
      await replyWithPreview(ctx);
    }
    else if (text === 'state') {
      await ctx.reply(`\`\`\`\n${JSON.stringify(ctx.session, null, 2)}\n\`\`\``, { parse_mode: 'Markdown' });
    } else if (text.startsWith('http')) {
      await handleUrl(text, ctx, config);
    } else {
      // unknown message. see if it's a url...
      ctx.reply('paste a url to get started');
    }
  });

  // launch bot
  // const port = webhookUrl.port ? parseInt(webhookUrl.port) : 443;

  // const webhookConfig = {
  //   domain: webhookUrl.hostname,
  //   port,
  //   path: webhookUrl.pathname,
  //   secretToken,
  // }

  // console.log(webhookConfig);

  bot.launch();
  // bot.launch({
  //   webhook: webhookConfig
  // });

  return bot;
}
