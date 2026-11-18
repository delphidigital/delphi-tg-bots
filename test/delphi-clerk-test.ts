import { expect } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import { mask } from '../utils/index.js';
import {
  createRead,
  ensureNonDuplicateLink,
  fetchUrlMetadata,
  graphemeLength,
  handleUpdateUrl,
  hydraUrl,
  logReadsError,
  replyPrivately,
  readsErrorReply,
  ReadsApiError,
  type BotConfig,
} from '../bots/delphi-clerk.ts';

const testConfig: BotConfig = {
  botToken: 'test-token',
  openaiKey: 'test-openai',
  delphiApi: {
    mpcCreateAfApiKey: 'af-key',
    baseUrl: 'https://members.example.com',
    hydraBaseUrl: 'https://hydra.example.com',
    readsApiKey: 'reads-key',
    readingListId: '9',
  },
};

const item = {
  title: 'A read',
  link: 'https://example.com/post',
  description: '',
  image_url: '',
  taxonomy: ['ai' as const],
  tags: ['reads' as const],
};

const respond = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('test: delphi-clerk reads through Hydra', () => {
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('createRead', () => {
    it('posts the read to Hydra as the sender, with the reads key and tenant', async () => {
      fetchStub.returns(respond(201, { data: { id: 1 } }));

      await createRead(item, { id: 4242, username: 'analyst' }, testConfig);

      const [url, init] = fetchStub.firstCall.args;
      expect(url).to.equal('https://hydra.example.com/api/v1/bots/tg/reads');
      expect(init.method).to.equal('POST');
      expect(init.headers.Authorization).to.equal('Bearer reads-key');
      expect(init.headers['x-tenant-id']).to.equal('delphi');

      const { read } = JSON.parse(init.body);
      expect(read.tg_user_id).to.equal(4242);
      expect(read.tg_username).to.equal('analyst');
      expect(read.link).to.equal('https://example.com/post');
      expect(read).to.not.have.property('description');
      expect(read).to.not.have.property('image_url');
    });

    it('keeps a description and image when set', async () => {
      fetchStub.returns(respond(201));

      await createRead(
        { ...item, description: 'Why it matters', image_url: 'https://img.example.com/a.png' },
        { id: 1 },
        testConfig,
      );

      const { read } = JSON.parse(fetchStub.firstCall.args[1].body);
      expect(read.description).to.equal('Why it matters');
      expect(read.image_url).to.equal('https://img.example.com/a.png');
    });

    const refusal = async (status: number, body: unknown = {}) => {
      fetchStub.returns(respond(status, body));
      try {
        await createRead(item, { id: 1 }, testConfig);
      } catch (e) {
        return e as ReadsApiError;
      }
      throw new Error('expected createRead to throw');
    };

    it('a not_linked refusal carries the page to link on', async () => {
      const error = await refusal(403, {
        error_code: 'not_linked',
        link_url: 'https://members.example.com/pro-chat',
      });

      expect(error).to.be.instanceOf(ReadsApiError);
      expect(error.kind).to.equal('not_linked');
      expect(error.linkUrl).to.equal('https://members.example.com/pro-chat');
      expect(error.status).to.equal(403);
    });

    it('a 403 Hydra does not explain keeps its status and error code', async () => {
      const error = await refusal(403, { error_code: 'forbidden' });
      expect(error.kind).to.equal('unavailable');
      expect(error.status).to.equal(403);
      expect(error.details).to.equal('forbidden');
    });

    it('a body of null is read as no body', async () => {
      expect((await refusal(403, null)).kind).to.equal('unavailable');
    });

    it('a 400 without field errors is invalid with no details', async () => {
      const error = await refusal(400, { error_code: 'bad_request' });
      expect(error.kind).to.equal('invalid');
      expect(error.details).to.be.undefined;
    });

    it('maps the other refusals', async () => {
      expect((await refusal(403, { error_code: 'not_employee' })).kind).to.equal('not_employee');
      expect((await refusal(403, {})).kind).to.equal('unavailable');
      expect((await refusal(409, { error_code: 'duplicate' })).kind).to.equal('duplicate');
      expect((await refusal(401)).kind).to.equal('unavailable');
      expect((await refusal(503)).kind).to.equal('unavailable');
      expect((await refusal(500)).kind).to.equal('unknown');
    });

    it('a validation refusal lists the fields', async () => {
      const error = await refusal(422, {
        message: 'Parameter validation error',
        errors: { title: ['length must be at most 100'] },
      });

      expect(error.kind).to.equal('invalid');
      expect(error.details).to.equal('[title]: length must be at most 100');
    });
  });

  describe('without the Hydra settings', () => {
    const unconfigured: BotConfig = {
      ...testConfig,
      delphiApi: { ...testConfig.delphiApi, hydraBaseUrl: undefined, readsApiKey: undefined },
    };

    it('Reads is unavailable and nothing is requested', async () => {
      for (const call of [
        () => createRead(item, { id: 1 }, unconfigured),
        () => fetchUrlMetadata('https://example.com/', unconfigured),
      ]) {
        let error: ReadsApiError | undefined;
        try {
          await call();
        } catch (e) {
          error = e as ReadsApiError;
        }
        expect(error?.kind).to.equal('unavailable');
      }

      await ensureNonDuplicateLink('https://example.com/post', unconfigured);
      expect(fetchStub.called).to.be.false;
    });
  });

  it('createRead without a sender is refused before any request', async () => {
    let error: ReadsApiError | undefined;
    try {
      await createRead(item, undefined, testConfig);
    } catch (e) {
      error = e as ReadsApiError;
    }
    expect(error?.kind).to.equal('unknown');
    expect(fetchStub.called).to.be.false;
  });

  describe('readsErrorReply', () => {
    it('tells an unlinked sender where to link', () => {
      const reply = readsErrorReply(
        new ReadsApiError('not_linked', { linkUrl: 'https://members.example.com/pro-chat' }),
      );

      expect(reply).to.contain("isn't linked");
      expect(reply).to.contain('https://members.example.com/pro-chat');
    });

    it('tells a non-employee who can help', () => {
      expect(readsErrorReply(new ReadsApiError('not_employee'))).to.contain('Delphi employees');
    });
  });

  describe('fetchUrlMetadata', () => {
    it('asks Hydra with the link URL-encoded and the reads key', async () => {
      fetchStub.returns(respond(200, { title: 't', description: 'd', image: null }));
      const link = 'https://example.com/a?x=1&y=2+3#frag';

      const metadata = await fetchUrlMetadata(link, testConfig);

      const [url, init] = fetchStub.firstCall.args;
      expect(url).to.equal(
        `https://hydra.example.com/api/v1/bots/tg/reads/link-metadata?url=${encodeURIComponent(link)}`,
      );
      expect(new URL(url).searchParams.get('url')).to.equal(link);
      expect(init.headers.Authorization).to.equal('Bearer reads-key');
      expect(metadata.title).to.equal('t');
    });

    it('a bad or missing key is unavailable, not a page Hydra could not read', async () => {
      for (const status of [401, 503]) {
        fetchStub.returns(respond(status, {}));
        let error: ReadsApiError | undefined;
        try {
          await fetchUrlMetadata('https://example.com/', testConfig);
        } catch (e) {
          error = e as ReadsApiError;
        }
        expect(error).to.be.instanceOf(ReadsApiError);
        expect(error?.kind).to.equal('unavailable');
      }
    });

    it('a 200 with a null body is no metadata', async () => {
      fetchStub.returns(respond(200, null));
      expect(await fetchUrlMetadata('https://example.com/', testConfig)).to.deep.equal({});
    });

    it('throws when Hydra cannot fetch the page', async () => {
      fetchStub.returns(respond(502, { error_code: 'fetch_failed' }));

      let thrown = false;
      try {
        await fetchUrlMetadata('https://example.com/', testConfig);
      } catch {
        thrown = true;
      }
      expect(thrown).to.be.true;
    });
  });

  describe('ensureNonDuplicateLink', () => {
    it("reads Hydra's reading list with the tenant header", async () => {
      fetchStub.returns(respond(200, { data: [{ link: 'https://example.com/other' }] }));

      await ensureNonDuplicateLink('https://example.com/post', testConfig);

      const [url, init] = fetchStub.firstCall.args;
      expect(url).to.equal(hydraUrl('/api/v1/lists/9/items?page=1&limit=50', testConfig));
      expect(init.headers['x-tenant-id']).to.equal('delphi');
    });

    it('carries on when Hydra cannot be reached or answers oddly', async () => {
      fetchStub.rejects(new Error('ECONNRESET'));
      await ensureNonDuplicateLink('https://example.com/post', testConfig);

      fetchStub.returns(respond(200, { data: 'not a list' }));
      await ensureNonDuplicateLink('https://example.com/post', testConfig);

      fetchStub.returns(respond(200, { data: [null, { link: 'https://example.com/other' }] }));
      await ensureNonDuplicateLink('https://example.com/post', testConfig);
    });

    it("carries on when the list can't be read", async () => {
      fetchStub.returns(respond(503, {}));
      await ensureNonDuplicateLink('https://example.com/post', testConfig);
    });

    it('throws for a link already on the list', async () => {
      fetchStub.returns(respond(200, { data: [{ link: 'https://example.com/post' }] }));

      let thrown = false;
      try {
        await ensureNonDuplicateLink('https://example.com/post', testConfig);
      } catch {
        thrown = true;
      }
      expect(thrown).to.be.true;
    });
  });

  describe('replyPrivately', () => {
    const groupCtx = (sendMessage: sinon.SinonStub) => {
      const reply = sinon.stub().resolves();
      return {
        ctx: { chat: { type: 'group' }, from: { id: 77 }, reply, telegram: { sendMessage } } as any,
        reply,
      };
    };

    it('sends the refusal to the sender, and only a pointer to the group', async () => {
      const sendMessage = sinon.stub().resolves();
      const { ctx, reply } = groupCtx(sendMessage);

      await replyPrivately(ctx, 'not linked: https://members.example.com/pro-chat');

      expect(sendMessage.calledWith(77, 'not linked: https://members.example.com/pro-chat')).to.be.true;
      expect(reply.firstCall.args[0]).to.not.contain('pro-chat');
    });

    it('falls back to a group reply without details when Telegram refuses the DM', async () => {
      const sendMessage = sinon.stub().rejects(new Error("403: bot can't initiate conversation"));
      const { ctx, reply } = groupCtx(sendMessage);

      await replyPrivately(ctx, 'not linked: https://members.example.com/pro-chat');

      expect(reply.calledOnce).to.be.true;
      expect(reply.firstCall.args[0]).to.contain('start a chat with me');
      expect(reply.firstCall.args[0]).to.not.contain('pro-chat');
    });

    it('replies in place in a private chat', async () => {
      const sendMessage = sinon.stub().resolves();
      const reply = sinon.stub().resolves();
      await replyPrivately({ chat: { type: 'private' }, from: { id: 77 }, reply, telegram: { sendMessage } } as any, 'hi');
      expect(reply.calledWith('hi')).to.be.true;
      expect(sendMessage.called).to.be.false;
    });
  });

  it('graphemeLength counts characters as a reader sees them', () => {
    expect(graphemeLength('e\u0301')).to.equal(1);
    expect(graphemeLength('👍🏽')).to.equal(1);
    expect(graphemeLength('abc')).to.equal(3);
  });

  describe('handleUpdateUrl', () => {
    const privateCtx = () => ({
      chat: { type: 'private' },
      from: { id: 77 },
      session: { state: 'none', readsItem: {}, afPostItem: {} },
      reply: sinon.stub().resolves(),
      telegram: { sendMessage: sinon.stub().resolves() },
    }) as any;

    it('never summarises a page Hydra did not fetch (a refused address)', async () => {
      const axiosGet = sinon.stub(axios, 'get').resolves({ data: '<p>internal</p>' });
      fetchStub.callsFake((url: string) =>
        String(url).includes('link-metadata')
          ? respond(422, { error_code: 'url_refused' })
          : respond(200, { data: [] }),
      );
      const ctx = privateCtx();

      await handleUpdateUrl('http://169.254.169.254/latest', ctx, testConfig, {});

      expect(axiosGet.called).to.be.false;
      expect(ctx.session.readsItem.description).to.equal('');
    });

    const metadataFails = (status: number, body: unknown) => {
      sinon.stub(console, 'log');
      const error = sinon.stub(console, 'error');
      fetchStub.callsFake((url: string) =>
        String(url).includes('link-metadata') ? respond(status, body) : respond(200, { data: [] }),
      );
      return error;
    };
    const replies = (ctx: any) => ctx.reply.args.map(([text]: [string]) => text);

    for (const [status, body] of [[500, {}], [502, {}], [502, null]] as const) {
      it(`a metadata ${status} without Hydra's error code is an error, and the sender fills the fields in`, async () => {
        const error = metadataFails(status, body);
        const ctx = privateCtx();

        await handleUpdateUrl('https://example.com/post', ctx, testConfig, {});

        expect(error.args.map(([line]) => line)).to.deep.equal([
          `Error fetching url metadata: unknown (HTTP ${status})`,
        ]);
        expect(replies(ctx)).to.include("I couldn't fetch that page's details - set a title (and description) yourself.");
        expect(ctx.session.readsItem.link).to.equal('https://example.com/post');
      });
    }

    it('a metadata 503 is an error line, and the sender is told Reads is unavailable', async () => {
      const error = metadataFails(503, {});
      const ctx = privateCtx();

      await handleUpdateUrl('https://example.com/post', ctx, testConfig, {});

      expect(error.args.map(([line]) => line)).to.deep.equal(['Error fetching url metadata: unavailable (HTTP 503)']);
      expect(replies(ctx)).to.include('Reads is temporarily unavailable. Try again in a little while.');
      expect(ctx.session.readsItem.link).to.equal('');
      expect(ctx.session.state).to.equal('none');
    });

    for (const [status, code] of [[400, 'invalid_url'], [422, 'url_refused'], [502, 'fetch_failed']] as const) {
      it(`a page Hydra could not read (${status} ${code}) is logged once, as one line`, async () => {
        const log = sinon.stub(console, 'log');
        const error = sinon.stub(console, 'error');
        fetchStub.callsFake((url: string) =>
          String(url).includes('link-metadata')
            ? respond(status, { error_code: code })
            : respond(200, { data: [] }),
        );

        await handleUpdateUrl('https://example.com/post', privateCtx(), testConfig, {});

        expect(error.called).to.be.false;
        expect(log.args.filter(([line]) => String(line).includes(`received ${status}`))).to.have.length(1);
      });
    }
  });

  describe('logReadsError', () => {
    it("logs a sender's refusal as one line, without the error object", () => {
      const log = sinon.stub(console, 'log');
      const error = sinon.stub(console, 'error');

      logReadsError('Read not published', new ReadsApiError('not_linked', { status: 403 }));
      logReadsError('Read not published', new ReadsApiError('invalid', { status: 422, details: '[title]: too long' }));

      expect(error.called).to.be.false;
      expect(log.args).to.deep.equal([
        ['Read not published: not_linked (HTTP 403)'],
        ['Read not published: invalid (HTTP 422) - [title]: too long'],
      ]);
    });

    it('logs Hydra being unavailable or failing as an error line', () => {
      sinon.stub(console, 'log');
      const error = sinon.stub(console, 'error');

      logReadsError('Read not published', new ReadsApiError('unknown', { status: 500 }));

      expect(error.args).to.deep.equal([['Read not published: unknown (HTTP 500)']]);
    });

    it('keeps the full error for anything that is not a Reads refusal', () => {
      const error = sinon.stub(console, 'error');
      const boom = new Error('ECONNRESET');

      logReadsError('Read not published', boom);

      expect(error.args).to.deep.equal([['Read not published: ', boom]]);
    });
  });

  it('mask tolerates an unset value', () => {
    expect(mask(undefined)).to.equal('');
    expect(mask('abc')).to.equal('***');
  });
});
