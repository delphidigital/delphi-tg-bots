import { Telegraf, session, type Context } from 'telegraf';
import fs from 'fs';
import type { Update } from 'telegraf/types';
import Markup from 'telegraf/markup';
import OpenAI from 'openai';
import { summarizeURL } from './components/ai-summarizer.ts';
import {
  AUDIO_FILE_DIRECTORY, 
  downloadVoiceFileFromTg,
  getTgFilePathFromFileId,
  transcribeAudio
} from './components/voice-to-post.ts';

type BotState = 'await_description' | 'await_voice_title' | 'await_transcript' | 'await_title' | 'await_memo' | 'await_url' | 'build' | 'none';

type ReadsTag = 'reads' | 'tweets' | 'media' | 'news' | 'podcast' | 'other';

type SectorSlug = 'ai' | 'general' | 'finance' | 'infrastructure' | 'macro-markets' | 'metaverse';

const ERROR_UNAUTHORIZED = 'ERROR_UNAUTHORIZED';
const ERROR_UNKNOWN = 'ERROR_UNKNOWN';
const ERROR_DUPLICATE_READ = 'ERROR_DUPLICATE_READ';

const types: Option<ReadsTag>[] = [
  { slug: 'reads', title: 'Reads' },
  { slug: 'media', title: 'Media' },
  { slug: 'tweets', title: 'Tweets' },
  { slug: 'news', title: 'News' },
  { slug: 'podcast', title: 'Podcast' },
  { slug: 'other', title: 'Other' },
];

const sectors: Option<SectorSlug>[] = [
  { slug: 'general', title: 'General' },
  { slug: 'ai', title: 'AI' },
  { slug: 'finance', title: 'DeFi' },
  { slug: 'infrastructure', title: 'Infrastructure' },
  { slug: 'macro-markets', title: 'Macro & Markets' },
  { slug: 'metaverse', title: 'NFTs & Gaming' },
];

const defaultTagsForDomain: Record<string, ReadsTag[]> = {
  'bloomberg.com': ['news'],
  'medium.com': ['reads'],
  'spotify.com': ['podcast'],
  'x.com': ['tweets'],
  'youtube.com': ['media'],
} as const;

interface DelphiApi {
  mpcCreateReadApiKey: string;
  mpcCreateAfApiKey: string;
  baseUrl: string;
  readingListId: string;
}

export interface BotConfig {
  delphiApi: DelphiApi;
  openaiKey: string;
  botToken: string;
}

export interface Option<T> {
  slug: T;
  title: string;
}

interface ReadsItem {
  title: string;
  link: string;
  description: string;
  image_url: string;
  taxonomy: SectorSlug[];
  tags: ReadsTag[];
}

interface AfPostItem {
  transcripts: string[];
  currentTranscript: string;
  title: string;
  audio_url: string;
}

interface BotSession {
  state: BotState;
  readsItem: ReadsItem;
  afPostItem: AfPostItem;
}

interface ReadsContext<U extends Update = Update> extends Context<U> {
  session: BotSession;
}

interface UrlMetadata {
  title?: string;
  description?: string;
  image?: string;
}

const createNewReadsItem = (): ReadsItem => ({
  title: '',
  link: '',
  description: '',
  image_url: '',
  taxonomy: [],
  tags: [],
});

const createNewAfPostItem = (): AfPostItem => ({
  transcripts: [],
  currentTranscript: '',
  title: '',
  audio_url: '',
});

const createDefaultSession = (): BotSession => ({
  state: 'none',
  readsItem: createNewReadsItem(),
  afPostItem: createNewAfPostItem(),
});

/*
 *
 * Utils
 *
 */

export const cleanTextForMarkdown = (str: string) =>
  str
    .replace(/([-_*[,\]()~`>#+=|{}.!])/g, '\\$1')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/@/g, '＠');

export const getCleanItem = (item: ReadsItem) => {
  return ['title', 'description', 'image_url']
    .reduce(
    (acc, key) => ({ ...acc, [key]: cleanTextForMarkdown(item[key]) }),
    { ...item }
  );
}

const helpText = () => {
  return `
For questions or feedback, please post in the Delphi Engineering telegram channel:

[ENGINEERING] Delphi Engineering
`;
};

const previewText = ({ readsItem }: BotSession): string => {
  const cleanItem = getCleanItem(readsItem);

  return `here is what we've got so far:
\n__*Title*__
${cleanItem.title}
\n__*Description*__
${cleanItem.description}
\n__*Sector*__
${getOptionLabel(sectors, readsItem.taxonomy[0]) || ''}
\n__*Type*__
${getOptionLabel(types, readsItem.tags[0]) || ''}
`;
};

const getOptionLabel = (options: Option<ReadsTag | SectorSlug>[], option: string) => {
  const found = options.find(({ slug }) => slug === option);

  if (found) {
    return found.title;
  }
}

const normalizeUrl = (url: string) => {
  let cleanUrl = url;

  if (!cleanUrl.startsWith('http')) {
    cleanUrl = `https://${cleanUrl}`;
  }

  // enforce https
  cleanUrl = cleanUrl.replace('http://', 'https://');

  // normalize twitter links
  cleanUrl = cleanUrl.replace('vxtwitter.com', 'x.com');
  cleanUrl = cleanUrl.replace('twitter.com', 'x.com');

  // remove query params from x.com links
  if (cleanUrl.includes('x.com')) {
    const u = new URL(cleanUrl);
    cleanUrl = u.origin + u.pathname;
  }

  return cleanUrl;
};

const delphiApiUrl = (path: string, config: BotConfig) => {
  return `${config.delphiApi.baseUrl}${path}`
};

// download file from TG and store locally so that it can be transcribed
export async function downloadVoiceFile(fileId: string, uniqueFileId: string) {
  const filePath = await getTgFilePathFromFileId(fileId);
  await downloadVoiceFileFromTg(filePath, uniqueFileId);
}

export async function ensureNonDuplicateLink(link: string, config: BotConfig) {
  const readsUrl = delphiApiUrl(`/api/v1/lists/${config.delphiApi.readingListId}/items?page=1&limit=50`, config);
  const response = await fetch(readsUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });
  const json = await response.json();
  const matches = json.data.filter(read => read.link === link);
  if (matches.length) {
    throw new Error(ERROR_DUPLICATE_READ);
  }
}

const fetchUrlMetadata = async (url: string, config: BotConfig): Promise<UrlMetadata> => {
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

const ensureRequiredAfPostFieldsSet = async (ctx: ReadsContext, callback: Function) => {
  if (!ctx.session.afPostItem.title) {
    ctx.session.state = 'await_voice_title';
    await ctx.reply('send me a title for your AF post first');
    return;
  } else if (!ctx.session.afPostItem.transcripts.length) {
    ctx.session.state = 'await_transcript';
    await handleNotifyNeedsTranscript(ctx);
    return;
  }
  await callback();
};

const ensureLinkSet = async (ctx: ReadsContext, callback: Function) => {
  if (!ctx.session.readsItem.link) {
    await ctx.reply('send me a link first');
    return;
  }

  await callback();
};

const defaultTagsForUrl = (url: string): ReadsTag[] => {
  const domain = Object.keys(defaultTagsForDomain).find((domain) => url.includes(domain));

  if (domain) {
    return defaultTagsForDomain[domain];
  }

  return [];
};

/*
 *
 * Telegram Helpers
 *
 */

const replyWithPreview = async (ctx: ReadsContext) => {
  await ctx.reply(previewText(ctx.session), { parse_mode: 'MarkdownV2' });
  await displayCreateReadsMenu(ctx);
};

const displayCreateAfPostMenu = async (ctx: ReadsContext) => {
  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.callback('Start Over', 'newafpost'),
    ],
    [
      Markup.button.callback('Record a memo', 'anothervoice'),
    ],
    [
      Markup.button.callback('Save latest recording to post', 'savecurrenttranscription'),
    ],
    [
      Markup.button.callback('View latest unsaved transcript', 'viewcurrenttranscription'),
    ],
    [
      Markup.button.callback('Add image to post', 'promptforimage'),
    ],
    [
      Markup.button.callback('Set title for the post', 'setafposttitle'),
    ],
    [
      Markup.button.callback('View full AF post', 'viewafpost'),
    ],
    [
      Markup.button.callback('Post Full Transcript to AF', 'postafpost')
    ]
  ]);
  await ctx.reply('What would you like to do?', buttons);
};

const displayMainMenu = async (ctx: ReadsContext) => {
  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.callback('Create Read', 'newread'),
    ],
    [
      Markup.button.callback('Create AF Post', 'newafpost')
    ]
  ]);
  await ctx.reply('What would you like to do?', buttons);
};

const displayCreateReadsMenu = async (ctx: ReadsContext) => {
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
      Markup.button.callback('Start Over', 'newread'),
      Markup.button.callback('Help', 'help')
    ],
    [
      Markup.button.callback('Publish It!', 'publish')
    ]
  ]);
  await ctx.reply('What would you like to do?', buttons);
};

const displayOptionMenu = async (ctx: ReadsContext, options: Option<ReadsTag | SectorSlug>[], command: string, option: string) => {
  const buttonRows = [];
  for (let i = 0; i < options.length; i += 2) {
    const chunk = options.slice(i, i + 2);
    const optionRowButtons = chunk.map(({ slug, title }) => Markup.button.callback(title, `${command}_${slug}`));
    buttonRows.push(optionRowButtons);
  }
  const buttons = Markup.inlineKeyboard(buttonRows);
  await ctx.reply(`Select a ${option}: `, buttons);
};

const nextCreateReadBuildState = async (ctx: ReadsContext) => {
  ctx.session.state = 'build';
  await nextCreateReadState(ctx);
};

const resetState = (ctx: ReadsContext) => {
  ctx.session.state = 'none';
  ctx.session.readsItem = createNewReadsItem();
  ctx.session.afPostItem = createNewAfPostItem();
};

const nextCreateReadState = async (ctx: ReadsContext) => {
  if (ctx.session.state === 'build') {
    if (!ctx.session.readsItem.title) {
      return await handleSetTitle(ctx);
    }

    if (ctx.session.readsItem.taxonomy.length < 1) {
      return await handleSetTaxonomy(ctx);
    }

    if (ctx.session.readsItem.tags.length < 1) {
      return await handleSetTag(ctx);
    }

    return replyWithPreview(ctx);
  }
};

/*
 *
 * handlers
 *
 */

const handleDisplayMainMenu = async (ctx: ReadsContext) => {
  displayMainMenu(ctx);
}

const handlePostAfPostItemToFeed = async (ctx: ReadsContext, config: BotConfig) => {
  ensureRequiredAfPostFieldsSet(ctx, async () => {
    try {
      await postAfPost(ctx, config);
      resetState(ctx);
      await ctx.reply('AF post has been created!');
    } catch (e) {
      console.error('Error publishing AF post: ', e);
      switch (e.message) {
        case ERROR_UNAUTHORIZED:
          await ctx.reply('Unauthorized: reach out to engineering for assistance.');
          break;
        default:
          await ctx.reply('Oops, something went wrong - try to publish the AF post again');
      }
    }
    await handleDisplayMainMenu(ctx);
  });
};

const handleNewAfPost = async (ctx: ReadsContext) => {
  resetState(ctx);
  ctx.session.state = 'await_memo';
  await ctx.reply('record voice memo to generate AF post');
};

const handleNewRead = async (ctx: ReadsContext) => {
  resetState(ctx);
  ctx.session.state = 'await_url';
  await ctx.reply('what url do you want post?');
};

const postAfPost = async(ctx: ReadsContext, config: BotConfig) => {
  await ctx.reply('Attempting to publish...');
  const tg_username = ctx.callbackQuery.from.username;
  const { delphiApi: { mpcCreateAfApiKey } } = config;
  const postAfUrl = delphiApiUrl('/api/v1/bots/tg/create-af', config);
  const item = { ...ctx.session.afPostItem };
  const response = await fetch(postAfUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': mpcCreateAfApiKey
    },
    body: JSON.stringify({ ...item, tg_username })
  });

  if (response.status === 403) {
    throw new Error(ERROR_UNAUTHORIZED);
  } else if (response.status > 201) {
    const json = await response.json();
    if (json.errors) {
      let msg = json.message + ': ';
      (Object.keys(json.errors)).forEach(e => {
        msg += `[${e}]: ${json.errors[e][0]}. `;
      });
      await ctx.reply(msg);
    }
    throw new Error(ERROR_UNKNOWN);
  }
}

const postRead = async (ctx: ReadsContext, config: BotConfig) => {
  const { delphiApi: { mpcCreateReadApiKey } } = config;
  const postReadsUrl = delphiApiUrl('/api/v1/bots/tg/create-read', config);
  const tg_username = ctx.callbackQuery.from.username;
  const item = { ...ctx.session.readsItem };

  if (!item.description) {
    delete item.description;
  }

  await ctx.reply('Attempting to publish...');
  const response = await fetch(postReadsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': mpcCreateReadApiKey
    },
    body: JSON.stringify({ ...item, tg_username })
  });

  if (response.status === 403) {
    throw new Error(ERROR_UNAUTHORIZED);
  } else if (response.status === 409) {
    throw new Error(ERROR_DUPLICATE_READ);
  } else if (response.status > 201) {
    const json = await response.json();
    if (json.errors) {
      let msg = json.message + ': ';
      (Object.keys(json.errors)).forEach(e => {
        msg += `[${e}]: ${json.errors[e][0]}. `;
      });
      await ctx.reply(msg);
    }
    throw new Error(ERROR_UNKNOWN);
  }
};

const handlePost = async (ctx: ReadsContext, config: BotConfig) => {
  ensureLinkSet(ctx, async () => {
    try {
      await postRead(ctx, config);
      resetState(ctx);
      await ctx.reply('Item has been published. Paste another URL to start over or choose from below options:');
      await handleDisplayMainMenu(ctx);
    } catch (e) {
      console.error('Error publishing read: ', e);
      switch (e.message) {
        case ERROR_UNAUTHORIZED:
          await ctx.reply('Unauthorized: reach out to engineering for assistance.');
          break;
        case ERROR_DUPLICATE_READ:
          await ctx.reply('Oops, this item was already added recently.');
          resetState(ctx);
          await handleDisplayMainMenu(ctx);
          break;
        default:
          await ctx.reply('Oops, something went wrong - try to publish again or start over');
      }
    }
  });
};

const handleHelp = async (ctx: ReadsContext) => {
  await ctx.reply(helpText());
};

const handleSetDescription = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    ctx.session.state = 'await_description';
    await ctx.reply('what description do you want? type "none" for no description');
  });
};

const handleSetOption = async (ctx: ReadsContext, options: Option<ReadsTag | SectorSlug>[], command: string, option: string) => {
  ensureLinkSet(ctx, async () => {
    await displayOptionMenu(ctx, options, command, option);
  });
};

const handlePromptForImage = async (ctx: ReadsContext) => {
  ctx.reply('Image support coming soon!');
}

const handleViewCurentTranscription = async (ctx: ReadsContext) => {
  const transcript = ctx.session.afPostItem.currentTranscript;
  if (transcript !== '') {
    ctx.reply(`Current transcription:\n${ctx.session.afPostItem.currentTranscript}`);
  } else {
    ctx.reply('You must first record a memo to view its transcript');
  }
}

const handleSaveCurrentTranscription = async (ctx: ReadsContext) => {
  if (ctx.session.afPostItem.currentTranscript !== '') {
    ctx.session.afPostItem.transcripts.push(ctx.session.afPostItem.currentTranscript);
    ctx.session.afPostItem.currentTranscript = '';
    await ctx.reply('AF post updated with current transcript');
  } else {
    await ctx.reply('Record a memo before attempting to add it to the post');
  }
}

const handleAnotherVoice = async (ctx: ReadsContext) => {
  ctx.session.afPostItem.currentTranscript = '';
  await ctx.reply('Record a new memo to add to your post');
}

const handleViewAfPost = async (ctx: ReadsContext) => {
  const { title, transcripts } = ctx.session.afPostItem;
  await ctx.reply('*** AF Post ***');
  await ctx.reply(`Title:\n${title.length ? title : '[Not Set]'}`);
  await ctx.reply(`Body:\n${transcripts.length ? transcripts.join('\n\n') : '[Not Set]'}`);
}

const handleSetTaxonomy = async (ctx: ReadsContext) => await handleSetOption(ctx, sectors, 'setsector', 'sector');

const handleSetTag = async (ctx: ReadsContext) => await handleSetOption(ctx, types, 'settype', 'type');

const handleSetTitle = async (ctx: ReadsContext) => {
  ensureLinkSet(ctx, async () => {
    ctx.session.state = 'await_title';
    await ctx.reply('what title do you want?');
  });
};

const handleSetAfPostTitle = async (ctx: ReadsContext) => {
  ensureRequiredAfPostFieldsSet(ctx, async () => {
    ctx.session.state = 'await_voice_title';
    await ctx.reply('what title do you want?');
  });
};

/*
 *
 * Update Handlers
 *
 */

const handleSetCurrentTranscript = async(transcript: string, ctx: ReadsContext) => {
  ctx.session.afPostItem.currentTranscript = transcript;
};

const handleUpdateDescription = async (description: string, ctx: ReadsContext) => {
  if (description.length > 500) {
    await ctx.reply('sorry, that description too long');
    await handleSetDescription(ctx);
    return;
  }

  ctx.session.readsItem.description = description === 'none' ? '' : description;
  await nextCreateReadBuildState(ctx);
};

const handleUpdateTitle = async (title: string, ctx: ReadsContext) => {
  ctx.session.readsItem.title = title;
  await nextCreateReadBuildState(ctx);
};

const handleNotifyNeedsTranscript = async (ctx: ReadsContext) => {
  await ctx.reply('Your AF post has no content yet. You need to save the latest recorded memo to the post or record a new memo to get started.');
}

const handleUpdateAfPostTitle = async (title: string, ctx: ReadsContext) => {
  ctx.session.afPostItem.title = title;
  await ctx.reply(`AF Post title set: ${title}`);
  await displayCreateAfPostMenu(ctx);
};

const truncateString = (str: string, maxLength: number): string => {
  return str.length > maxLength ? str.substring(0, maxLength - 3) + "..." : str;
};

const handleUpdateUrl = async (url: string, ctx: ReadsContext, config: BotConfig, openai: any) => {
  resetState(ctx);

  await ctx.reply('fetching that url, hang on a sec...');

  const cleanUrl = normalizeUrl(url);
  let metadata: UrlMetadata;

  ctx.session.readsItem.link = cleanUrl;

  try {
    metadata = await fetchUrlMetadata(cleanUrl, config);
    await ensureNonDuplicateLink(cleanUrl, config);
  } catch (e) {
    console.error('Error proccessing handleUpdateUrl: ', e);
    if (e.message === ERROR_DUPLICATE_READ) {
      await ctx.reply('Oops, this url was recently added already');
      resetState(ctx);
      await handleDisplayMainMenu(ctx);
      return;
    }

    await ctx.reply('sorry, I could not fetch that url');
    await handleNewRead(ctx);
    return;
  }

  const { description, image, title } = metadata;

  if (!cleanUrl.includes('x.com')) {
    // not twitter, so save the title
    ctx.session.readsItem.title = title || "";
    // Generate and set the summary
    try {
      //const openai = new OpenAI({
      //  apiKey: config.openaiKey,
      //});
      const summary = await summarizeURL(url, openai || null);
      ctx.session.readsItem.description = truncateString(summary,500);
    } catch (e) {
      console.error("Error generating summary: ", e);
      ctx.session.readsItem.description = description ? truncateString(description,500) : "";
      await ctx.reply('sorry, generating the AI summary failed for that url. falling back to metadata description.');
    }
  } else {
    // Twitter URL, save the tweet text as the description
    ctx.session.readsItem.description = description ? truncateString(description,500) : "";
  }

  ctx.session.readsItem.tags = defaultTagsForUrl(cleanUrl);
  ctx.session.readsItem.image_url = image || "";
  ctx.session.state = "build";

  await nextCreateReadState(ctx);
};

/*
 *
 * Bot Setup
 *
 */
export const clerkBot = (config: BotConfig) => {
  const { botToken } = config;

  const bot = new Telegraf<ReadsContext>(botToken);

  const openai = new OpenAI({
    apiKey: config.openaiKey,
  });

  // setup session
  bot.use(session({ defaultSession: createDefaultSession }));

  const handlePublish = (ctx) => handlePost(ctx, config);
  const handlePostAfPost = (ctx) => handlePostAfPostItemToFeed(ctx, config);

  // commands
  bot.command('menu', handleDisplayMainMenu);
  bot.command('help', handleHelp);
  bot.command('newread', handleNewRead);
  bot.command('newafpost', handleNewAfPost);
  bot.command('publish', handlePublish);
  bot.command('preview', replyWithPreview);
  bot.command('setdescription', handleSetDescription);
  bot.command('settitle', handleSetTitle);
  bot.command('setafposttitle', handleSetAfPostTitle);
  bot.command('settype', handleSetTag);
  bot.command('setsector', handleSetTaxonomy);

  // actions
  bot.action('menu', handleDisplayMainMenu);
  bot.action('help', handleHelp);
  bot.action('newread', handleNewRead);
  bot.action('newafpost', handleNewAfPost);
  bot.action('postafpost', handlePostAfPost);
  bot.action('publish', handlePublish);
  bot.action('setdescription', handleSetDescription);
  bot.action('settitle', handleSetTitle);
  bot.action('setafposttitle', handleSetAfPostTitle);
  bot.action('settype', handleSetTag);
  bot.action('setsector', handleSetTaxonomy);
  bot.action('anothervoice', handleAnotherVoice);
  bot.action('viewafpost', handleViewAfPost);
  bot.action('savecurrenttranscription', handleSaveCurrentTranscription);
  bot.action('viewcurrenttranscription', handleViewCurentTranscription);
  bot.action('promptforimage', handlePromptForImage);

  // dynamic actions
  bot.action(/setsector_(.+)/, async (ctx) => {
    ctx.session.readsItem.taxonomy = [ctx.match[1] as SectorSlug];
    await nextCreateReadState(ctx);
  });

  bot.action(/settype_(.+)/, async (ctx) => {
    ctx.session.readsItem.tags = [ctx.match[1] as ReadsTag];
    await nextCreateReadState(ctx);
  });

  bot.hears('state', async (ctx) => {
    await ctx.reply(`\`\`\`\n${JSON.stringify(ctx.session, null, 2)}\n\`\`\``, { parse_mode: 'Markdown' });
  });

  bot.hears(/^https?\:/, async (ctx) => {
    await handleUpdateUrl(ctx.msg.text, ctx, config, openai);
  });

  bot.on('message', async (ctx) => {
    const { state } = ctx.session;
    const { text, voice } = ctx.msg;

    if (voice) {
      try {
        ctx.reply('Processing voice memo...');
        await downloadVoiceFile(voice.file_id, voice.file_unique_id);
        const localFilePath = `${AUDIO_FILE_DIRECTORY}/${voice.file_unique_id}.oga`;
        const transcription = await transcribeAudio(localFilePath, openai);
        fs.unlinkSync(localFilePath); // at some point, upload and embed in the AF post
        await handleSetCurrentTranscript(transcription, ctx);
        await ctx.reply(`Current Transcript:\n${transcription}`);
        await displayCreateAfPostMenu(ctx);
      } catch (e) {
        console.error('Unable to process voice memo: ', e);
        await ctx.reply('Unable to process voice memo at this time. Reach out to engineering if the issue persists.');
      }  
    }
    else if (text) {
      if(state === 'await_voice_title') {
        await handleUpdateAfPostTitle(text, ctx);
      }
      else if (state === 'await_transcript') {
        await handleNotifyNeedsTranscript(ctx);
      }
      else if (state === 'await_memo') {
        await ctx.reply('Record voice memo to continue');
      }
      else if (state === 'await_url') {
        await handleUpdateUrl(text, ctx, config, openai);
      }
      else if (state === 'await_description') {
        await handleUpdateDescription(text, ctx);
      }
      else if (state === 'await_title') {
        await handleUpdateTitle(text, ctx);
      }
      else {
        // unknown message, show the main menu
        await displayMainMenu(ctx);
      }
    }
    else {
      ctx.reply('Expect either text or voice - got neither.');
    }
  });

  return bot;
}
