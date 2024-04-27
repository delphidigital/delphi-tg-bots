import { Telegraf, session, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Update } from 'telegraf/types';

type ReadsState = 'await_title' | 'build' | 'none';

export interface ReadsConfig {
  botToken: string;
  secretToken: string;
  webhookUrl: string;
}

interface ReadsItems {
  title: string;
  link: string;
  description: string;
  image_url: string;
  taxonomy: string[];
  tags: string[];
}

interface ReadsSession {
  state: ReadsState;
  item: ReadsItems;
}

interface ReadsContext<U extends Update = Update> extends Context<U> {
  session: ReadsSession;
}

const createDefaultSession = (): ReadsSession => ({
  state: 'none',
  item: {
    title: '',
    link: '',
    description: '',
    image_url: '',
    taxonomy: [],
    tags: [],
  },
});

const previewText = ({ item }: ReadsSession): string => {
  return `
Title: ${item.title}
Description: ${item.description}
Image: ${item.image_url}
Sector: ${item.taxonomy[0] || ''}
Type: ${item.tags[0] || ''}
`;
};

const replyWithPreview = async (ctx: ReadsContext) => {
  await ctx.reply(previewText(ctx.session), { parse_mode: 'Markdown' });
}

export const readsBot = (config: ReadsConfig) => {
  const { botToken, secretToken: _, webhookUrl: _webhookUrlStr } = config;
  // const webhookUrl = new URL(webhookUrlStr);

  const bot = new Telegraf<ReadsContext>(botToken);

  // setup session
  bot.use(session({ defaultSession: createDefaultSession }))

  bot.command('settitle', async (ctx) => {
    ctx.session.state = 'await_title';
    await ctx.reply('What title do you want?');
  });

  bot.command('preview', async (ctx) => {
    replyWithPreview(ctx);
  });

  // handlers
  bot.on(message('text'), async (ctx) => {
    if (ctx.session.state === 'await_title') {
      ctx.session.item.title = ctx.msg.text;
      ctx.session.state = 'build';
      replyWithPreview(ctx);
    }
    else if (ctx.msg.text === 'state') {
      await ctx.reply(`\`\`\`\n${JSON.stringify(ctx.session, null, 2)}\n\`\`\``, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply('yeah... im not sure about that');
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
