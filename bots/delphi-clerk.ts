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
const ERROR_METADATA_FETCH = 'ERROR_METADATA_FETCH';
const NOT_CONFIGURED = 'Hydra reads not configured';
// link-metadata's answers for a page it could not or would not read.
const PAGE_UNREADABLE: Record<number, string> = { 400: 'invalid_url', 422: 'url_refused', 502: 'fetch_failed' };

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
  // Notes (AF posts) still go through the members portal BFF.
  mpcCreateAfApiKey: string;
  baseUrl: string;
  // Reads go to Hydra (hydra#2575, #2576) with the Reads bot's own key.
  // Either unset: Reads replies "temporarily unavailable" and Notes go on.
  hydraBaseUrl?: string;
  readsApiKey?: string;
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

const TENANT_HEADER = 'x-tenant-id';
const TENANT = 'delphi';

export const hydraUrl = (path: string, config: BotConfig) => {
  return `${config.delphiApi.hydraBaseUrl}${path}`;
};

const readsConfigured = (config: BotConfig) =>
  !!(config.delphiApi.hydraBaseUrl && config.delphiApi.readsApiKey);

const hydraHeaders = (config: BotConfig) => ({
  'Content-Type': 'application/json',
  [TENANT_HEADER]: TENANT,
  Authorization: `Bearer ${config.delphiApi.readsApiKey}`,
});

export type ReadsErrorKind = 'not_linked' | 'not_employee' | 'duplicate' | 'invalid' | 'unavailable' | 'unknown';

// A refusal from Hydra's Reads routes, with what the sender needs to act on it.
export class ReadsApiError extends Error {
  kind: ReadsErrorKind;
  linkUrl?: string;
  details?: string;
  status?: number;

  constructor(kind: ReadsErrorKind, opts: { linkUrl?: string; details?: string; status?: number } = {}) {
    super(kind);
    this.kind = kind;
    this.linkUrl = opts.linkUrl;
    this.details = opts.details;
    this.status = opts.status;
  }
}

// The sender's own refusals (not linked, not an employee, a duplicate, a
// field Hydra rejected) are expected, so they log one line, not a stack.
// Hydra being unreachable or answering oddly is logged as an error; anything
// that is not a Reads refusal keeps its full error.
const READS_REFUSALS: ReadsErrorKind[] = ['not_linked', 'not_employee', 'duplicate', 'invalid'];

export const logReadsError = (prefix: string, e: unknown) => {
  if (!(e instanceof ReadsApiError)) {
    console.error(`${prefix}: `, e);
    return;
  }

  const line = `${prefix}: ${e.kind}${e.status ? ` (HTTP ${e.status})` : ''}${e.details ? ` - ${e.details}` : ''}`;
  if (READS_REFUSALS.includes(e.kind)) console.log(line);
  else console.error(line);
};

// download file from TG and store locally so that it can be transcribed
export async function downloadVoiceFile(fileId: string, uniqueFileId: string) {
  const filePath = await getTgFilePathFromFileId(fileId);
  await downloadVoiceFileFromTg(filePath, uniqueFileId);
}

// An early check so the sender hears before filling in the read; Hydra's
// create route refuses a duplicate either way (409).
export async function ensureNonDuplicateLink(link: string, config: BotConfig) {
  if (!readsConfigured(config)) return;

  const readsUrl = hydraUrl(`/api/v1/lists/${config.delphiApi.readingListId}/items?page=1&limit=50`, config);
  const response = await fetch(readsUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      [TENANT_HEADER]: TENANT,
    }
  }).catch((e) => {
    console.error('Could not read the reading list for the duplicate check: ', e);
    return null;
  });

  if (!response) return;
  // Only a heads-up: when the list can't be read, carry on and let the
  // create route's 409 decide.
  if (!response.ok) return;
  const json = await response.json().catch(() => ({}));
  const reads = Array.isArray(json.data) ? json.data : [];
  if (reads.some((read) => read?.link === link)) {
    throw new Error(ERROR_DUPLICATE_READ);
  }
}

export const fetchUrlMetadata = async (url: string, config: BotConfig): Promise<UrlMetadata> => {
  if (!readsConfigured(config)) throw new ReadsApiError('unavailable', { details: NOT_CONFIGURED });

  const metadataUrl = hydraUrl(`/api/v1/bots/tg/reads/link-metadata?url=${encodeURIComponent(url)}`, config);
  console.log(`fetching metadata for ${url}`);
  const res = await fetch(metadataUrl, { headers: hydraHeaders(config) });
  if (res.status === 401 || res.status === 503) throw new ReadsApiError('unavailable', { status: res.status });
  if (res.status === 200) return ((await res.json()) ?? {}) as UrlMetadata;

  // Hydra's answers for a page it could not or would not read: expected, so
  // one line. Anything else, including a 502 from the gateway in front of a
  // Hydra that is down (no error_code), is Hydra failing, and is an error.
  const json = (await res.json().catch(() => null)) ?? {};
  if (PAGE_UNREADABLE[res.status] && json.error_code === PAGE_UNREADABLE[res.status]) {
    console.log(`received ${res.status} fetching url metadata for ${url}`);
    throw new Error(ERROR_METADATA_FETCH);
  }
  throw new ReadsApiError('unknown', { status: res.status });
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

// Creates the read in Hydra as the sender, identified by Telegram's numeric
// user id (the username is only shown in the internal announcement). Hydra
// announces the read in the channels. Throws ReadsApiError on a refusal.
export const createRead = async (
  item: ReadsItem,
  from: { id: number; username?: string } | undefined,
  config: BotConfig,
) => {
  if (!readsConfigured(config)) throw new ReadsApiError('unavailable', { details: NOT_CONFIGURED });
  if (!from) throw new ReadsApiError('unknown');

  const read: Partial<ReadsItem> & { tg_user_id: number; tg_username?: string } = {
    ...item,
    tg_user_id: from.id,
    tg_username: from.username,
  };

  if (!read.description) delete read.description;
  if (!read.image_url) delete read.image_url;

  const response = await fetch(hydraUrl('/api/v1/bots/tg/reads', config), {
    method: 'POST',
    headers: hydraHeaders(config),
    body: JSON.stringify({ read }),
  });

  if (response.status === 201) return;

  const json = (await response.json().catch(() => null)) ?? {};
  const status = response.status;

  switch (status) {
    case 403:
      if (json.error_code === 'not_linked') throw new ReadsApiError('not_linked', { linkUrl: json.link_url, status });
      if (json.error_code === 'not_employee') throw new ReadsApiError('not_employee', { status });
      throw new ReadsApiError('unavailable', { status, details: json.error_code });
    case 409:
      throw new ReadsApiError('duplicate', { status });
    case 400:
    case 422: {
      const details = json.errors
        ? Object.keys(json.errors).map((field) => `[${field}]: ${json.errors[field][0]}`).join('. ')
        : undefined;
      throw new ReadsApiError('invalid', { details, status });
    }
    case 401:
    case 503:
      throw new ReadsApiError('unavailable', { status });
    default:
      throw new ReadsApiError('unknown', { status });
  }
};

export const readsErrorReply = (error: ReadsApiError): string => {
  switch (error.kind) {
    case 'not_linked':
      return "Your Telegram account isn't linked to your Delphi account yet. " +
        `Link it here: ${error.linkUrl || 'members.delphidigital.io/pro-chat'} - then tap Publish again.`;
    case 'not_employee':
      return 'Reads can only be posted by Delphi employees. If you are one, ask Engineering to check your account.';
    case 'duplicate':
      return 'Oops, this item was already added recently.';
    case 'invalid':
      return `That read wasn't accepted${error.details ? `: ${error.details}` : ''}. Fix it and tap Publish again.`;
    case 'unavailable':
      return 'Reads is temporarily unavailable. Try again in a little while.';
    default:
      return 'Oops, something went wrong - try to publish again or start over';
  }
};

// ctx.from is the sender for the Publish button and the /publish command.
const postRead = async (ctx: ReadsContext, config: BotConfig) => {
  await ctx.reply('Attempting to publish...');
  await createRead(ctx.session.readsItem, ctx.from, config);
};

// Refusals name the sender's account, so outside a private chat they go to
// the sender directly rather than to the group. Telegram refuses a message to
// someone who never started the bot; the group then gets a reply without the
// account details.
export const replyPrivately = async (ctx: ReadsContext, text: string) => {
  if (ctx.chat?.type === 'private' || !ctx.from) {
    await ctx.reply(text);
    return;
  }

  try {
    await ctx.telegram.sendMessage(ctx.from.id, text);
    await ctx.reply('I sent you a direct message about this read.');
  } catch (e) {
    console.error('Could not message the sender privately: ', e);
    await ctx.reply("I couldn't publish that, and couldn't message you privately - start a chat with me and tap Publish again.");
  }
};

const handlePost = async (ctx: ReadsContext, config: BotConfig) => {
  return ensureLinkSet(ctx, async () => {
    try {
      await postRead(ctx, config);
      resetState(ctx);
      await ctx.reply('Item has been published. Paste another URL to start over or choose from below options:');
      await handleDisplayMainMenu(ctx);
    } catch (e) {
      logReadsError('Read not published', e);
      if (e instanceof ReadsApiError) {
        await replyPrivately(ctx, readsErrorReply(e));
        // The draft is kept so the sender can publish again, except for a
        // duplicate, which there is no point retrying.
        if (e.kind === 'duplicate') {
          resetState(ctx);
          await handleDisplayMainMenu(ctx);
        }
      } else {
        await ctx.reply(readsErrorReply(new ReadsApiError('unknown')));
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
  // Hydra's limit for a read's title, counted as Hydra counts it (characters
  // as a reader sees them).
  if (graphemeLength(title) > 100) {
    await ctx.reply('sorry, that title is too long (100 characters at most)');
    await handleSetTitle(ctx);
    return;
  }

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

export const graphemeLength = (str: string): number =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)].length;

const truncateString = (str: string, maxLength: number): string => {
  return str.length > maxLength ? str.substring(0, maxLength - 3) + "..." : str;
};

export const handleUpdateUrl = async (url: string, ctx: ReadsContext, config: BotConfig, openai: any) => {
  resetState(ctx);

  await ctx.reply('fetching that url, hang on a sec...');

  const cleanUrl = normalizeUrl(url);
  let metadata: UrlMetadata;

  ctx.session.readsItem.link = cleanUrl;

  let duplicate = false;
  try {
    await ensureNonDuplicateLink(cleanUrl, config);
  } catch (e) {
    // Only a duplicate stops here; anything else is left to the create route.
    if (e.message === ERROR_DUPLICATE_READ) duplicate = true;
    else console.error('Duplicate check failed: ', e);
  }

  if (duplicate) {
    await ctx.reply('Oops, this url was recently added already');
    resetState(ctx);
    await handleDisplayMainMenu(ctx);
    return;
  }

  // Only a page Hydra fetched (public address, checked) is summarised: the
  // summariser requests the URL itself without that check.
  let fetched = true;
  try {
    metadata = await fetchUrlMetadata(cleanUrl, config);
  } catch (e) {
    fetched = false;
    // fetchUrlMetadata already logged a page Hydra could not read; every
    // other failure is logged here.
    if (!(e instanceof Error && e.message === ERROR_METADATA_FETCH)) logReadsError('Error fetching url metadata', e);
    if (e instanceof ReadsApiError && e.kind === 'unavailable') {
      await ctx.reply(readsErrorReply(e));
      resetState(ctx);
      await handleDisplayMainMenu(ctx);
      return;
    }

    // Hydra could not read the page (blocked, down, an X post the preview
    // service refused): carry on, and the sender fills the fields in.
    await ctx.reply("I couldn't fetch that page's details - set a title (and description) yourself.");
    metadata = {};
  }

  const { description, image, title } = metadata;

  if (!cleanUrl.includes('x.com')) {
    // not twitter, so save the title
    ctx.session.readsItem.title = title || "";
    // Generate and set the summary
    if (!fetched) {
      ctx.session.readsItem.description = "";
    } else {
      try {
        const summary = await summarizeURL(url, openai || null);
        ctx.session.readsItem.description = truncateString(summary,500);
      } catch (e) {
        console.error("Error generating summary: ", e);
        ctx.session.readsItem.description = description ? truncateString(description,500) : "";
        await ctx.reply(description
          ? 'sorry, generating the AI summary failed for that url. falling back to metadata description.'
          : 'sorry, generating the AI summary failed for that url. set a description yourself if you want one.');
      }
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
