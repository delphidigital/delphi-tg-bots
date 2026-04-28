import { expect } from 'chai';
import sinon from 'sinon';
import {
  isValidDate,
  isValidTime,
  formatDate,
  formatTime,
  escapeHtml,
  createNewEventDraft,
  apiUrl,
  fetchCategories,
  fetchUpcomingEvents,
  fetchHotEvents,
  formatHotListBlock,
  formatWeeklyDigest,
  hotFeedbackKeyboard,
  parseHotFeedback,
  chunkForTelegram,
  createEvent,
  type CalendarBotConfig,
  type CalendarEventDraft,
  type CalendarEventResponse,
} from '../bots/calendar-bot.ts';

const testConfig: CalendarBotConfig = {
  botToken: 'test-token',
  delphiApi: {
    baseUrl: 'https://api.example.com',
    calendarApiKey: 'test-api-key',
  },
};

describe('test: calendar-bot module', () => {
  describe('test-helpers', () => {
    describe('isValidDate', () => {
      it('should accept a valid date', () => {
        expect(isValidDate('2026-03-15')).to.be.true;
      });

      it('should reject invalid format', () => {
        expect(isValidDate('03-15-2026')).to.be.false;
        expect(isValidDate('2026/03/15')).to.be.false;
        expect(isValidDate('not-a-date')).to.be.false;
      });

      it('should reject impossible dates', () => {
        expect(isValidDate('2026-02-31')).to.be.false;
        expect(isValidDate('2026-04-31')).to.be.false;
        expect(isValidDate('2026-13-01')).to.be.false;
        expect(isValidDate('2026-00-15')).to.be.false;
      });

      it('should handle leap years correctly', () => {
        expect(isValidDate('2024-02-29')).to.be.true;
        expect(isValidDate('2025-02-29')).to.be.false;
      });
    });

    describe('isValidTime', () => {
      it('should accept valid times', () => {
        expect(isValidTime('00:00')).to.be.true;
        expect(isValidTime('12:00')).to.be.true;
        expect(isValidTime('23:59')).to.be.true;
        expect(isValidTime('14:30')).to.be.true;
      });

      it('should reject out-of-range times', () => {
        expect(isValidTime('24:00')).to.be.false;
        expect(isValidTime('25:00')).to.be.false;
        expect(isValidTime('99:99')).to.be.false;
        expect(isValidTime('12:60')).to.be.false;
      });

      it('should reject invalid format', () => {
        expect(isValidTime('2:30')).to.be.false;
        expect(isValidTime('14:3')).to.be.false;
        expect(isValidTime('noon')).to.be.false;
      });
    });

    describe('formatDate', () => {
      it('should format a date string', () => {
        const result = formatDate('2026-03-15');
        expect(result).to.include('Mar');
        expect(result).to.include('15');
        expect(result).to.include('2026');
      });
    });

    describe('formatTime', () => {
      it('should convert 24h to 12h AM/PM', () => {
        expect(formatTime('14:30')).to.equal('2:30 PM');
        expect(formatTime('09:15')).to.equal('9:15 AM');
      });

      it('should handle midnight', () => {
        expect(formatTime('00:00')).to.equal('12:00 AM');
      });

      it('should handle noon', () => {
        expect(formatTime('12:00')).to.equal('12:00 PM');
      });

      it('should return empty string for falsy input', () => {
        expect(formatTime('')).to.equal('');
      });
    });

    describe('escapeHtml', () => {
      it('should escape ampersands', () => {
        expect(escapeHtml('A & B')).to.equal('A &amp; B');
      });

      it('should escape angle brackets', () => {
        expect(escapeHtml('<script>')).to.equal('&lt;script&gt;');
      });

      it('should handle strings with no special chars', () => {
        expect(escapeHtml('hello world')).to.equal('hello world');
      });

      it('should handle combined special chars', () => {
        expect(escapeHtml('a < b & c > d')).to.equal('a &lt; b &amp; c &gt; d');
      });
    });

    describe('createNewEventDraft', () => {
      it('should return a fresh draft with empty defaults', () => {
        const draft = createNewEventDraft();
        expect(draft.name).to.equal('');
        expect(draft.date).to.equal('');
        expect(draft.time).to.equal('');
        expect(draft.end_date).to.equal('');
        expect(draft.category_id).to.be.null;
        expect(draft.category_name).to.equal('');
        expect(draft.description).to.equal('');
        expect(draft.link).to.equal('');
      });

      it('should return independent instances', () => {
        const a = createNewEventDraft();
        const b = createNewEventDraft();
        a.name = 'test';
        expect(b.name).to.equal('');
      });
    });

    describe('apiUrl', () => {
      it('should concatenate baseUrl and path', () => {
        expect(apiUrl('/api/v1/calendar/categories', testConfig))
          .to.equal('https://api.example.com/api/v1/calendar/categories');
      });
    });
  });

  describe('test-api-functions', () => {
    afterEach(() => {
      sinon.restore();
    });

    describe('fetchCategories', () => {
      it('should return categories on success', async () => {
        const mockCategories = [
          { id: 1, name: 'TGE', slug: 'tge', color: '#10B981' },
          { id: 2, name: 'Fed/Macro', slug: 'fed-macro', color: '#3B82F6' },
        ];

        sinon.stub(globalThis, 'fetch').resolves(
          new Response(JSON.stringify({ categories: mockCategories }), { status: 200 })
        );

        const result = await fetchCategories(testConfig);
        expect(result).to.deep.equal(mockCategories);
      });

      it('should return null on non-OK status', async () => {
        sinon.stub(globalThis, 'fetch').resolves(
          new Response('Internal Server Error', { status: 500 })
        );

        const result = await fetchCategories(testConfig);
        expect(result).to.be.null;
      });

      it('should return null on network error', async () => {
        sinon.stub(globalThis, 'fetch').rejects(new Error('Network error'));

        const result = await fetchCategories(testConfig);
        expect(result).to.be.null;
      });
    });

    describe('fetchUpcomingEvents', () => {
      it('should return events on success', async () => {
        const mockResponse = {
          events: [{ id: '1', name: 'Test Event', date: '2026-03-15', time: null, end_date: null, description: null, link: null, category: null }],
          total: 1,
        };

        sinon.stub(globalThis, 'fetch').resolves(
          new Response(JSON.stringify(mockResponse), { status: 200 })
        );

        const result = await fetchUpcomingEvents(testConfig);
        expect(result.events).to.have.lengthOf(1);
        expect(result.total).to.equal(1);
      });

      it('should return empty response on error', async () => {
        sinon.stub(globalThis, 'fetch').rejects(new Error('Network error'));

        const result = await fetchUpcomingEvents(testConfig);
        expect(result.events).to.deep.equal([]);
        expect(result.total).to.equal(0);
      });
    });

    describe('createEvent', () => {
      const testEvent: CalendarEventDraft = {
        name: 'Test Event',
        date: '2026-03-15',
        time: '14:00',
        end_date: '',
        category_id: 1,
        category_name: 'TGE',
        description: 'A test event',
        link: 'https://example.com',
      };

      it('should return ok on success', async () => {
        sinon.stub(globalThis, 'fetch').resolves(
          new Response(JSON.stringify({ id: '1' }), { status: 201 })
        );

        const result = await createEvent(testConfig, testEvent, 'testuser');
        expect(result.ok).to.be.true;
      });

      it('should return error on 401', async () => {
        sinon.stub(globalThis, 'fetch').resolves(
          new Response('Unauthorized', { status: 401 })
        );

        const result = await createEvent(testConfig, testEvent, 'testuser');
        expect(result.ok).to.be.false;
        expect(result.error).to.include('Unauthorized');
      });

      it('should return generic error on 422', async () => {
        sinon.stub(globalThis, 'fetch').resolves(
          new Response('{"errors": {"name": ["is required"]}}', { status: 422 })
        );

        const result = await createEvent(testConfig, testEvent, 'testuser');
        expect(result.ok).to.be.false;
        expect(result.error).to.include('Validation error');
        // Should NOT leak raw error body
        expect(result.error).to.not.include('is required');
      });

      it('should return server error on 500', async () => {
        sinon.stub(globalThis, 'fetch').resolves(
          new Response('Internal Server Error', { status: 500 })
        );

        const result = await createEvent(testConfig, testEvent, 'testuser');
        expect(result.ok).to.be.false;
        expect(result.error).to.include('500');
      });

      it('should return network error on fetch failure', async () => {
        sinon.stub(globalThis, 'fetch').rejects(new Error('Connection refused'));

        const result = await createEvent(testConfig, testEvent, 'testuser');
        expect(result.ok).to.be.false;
        expect(result.error).to.equal('Network error');
      });

      it('should omit optional fields when empty', async () => {
        const minimalEvent: CalendarEventDraft = {
          name: 'Minimal Event',
          date: '2026-03-15',
          time: '',
          end_date: '',
          category_id: 1,
          category_name: 'TGE',
          description: '',
          link: '',
        };

        const fetchStub = sinon.stub(globalThis, 'fetch').resolves(
          new Response(JSON.stringify({ id: '1' }), { status: 201 })
        );

        await createEvent(testConfig, minimalEvent, 'testuser');

        const requestBody = JSON.parse(fetchStub.firstCall.args[1]!.body as string);
        expect(requestBody.event).to.not.have.property('time');
        expect(requestBody.event).to.not.have.property('end_date');
        expect(requestBody.event).to.not.have.property('description');
        expect(requestBody.event).to.not.have.property('link');
      });
    });

    // ==================== Hot list (Phase 1) ====================

    describe('fetchHotEvents', () => {
      it('hits the API with is_hot=true filter', async () => {
        const fetchStub = sinon.stub(globalThis, 'fetch').resolves(
          new Response(JSON.stringify({ events: [], total: 0 }), { status: 200 })
        );

        await fetchHotEvents(testConfig);

        const calledUrl = fetchStub.firstCall.args[0] as string;
        expect(calledUrl).to.include('is_hot=true');
        expect(calledUrl).to.include('status=published');
      });

      it('returns empty result on network error', async () => {
        sinon.stub(globalThis, 'fetch').rejects(new Error('boom'));

        const result = await fetchHotEvents(testConfig);
        expect(result.events).to.deep.equal([]);
        expect(result.total).to.equal(0);
      });
    });

    describe('formatHotListBlock', () => {
      const baseEvent: CalendarEventResponse = {
        id: '1',
        name: 'FOMC Decision',
        date: '2026-05-01',
        time: '14:00',
        end_date: null,
        description: null,
        link: null,
        category: { name: 'Fed/Macro Events', slug: 'fed-macro' },
      };

      it('returns null when no hot events', () => {
        const events = [{ ...baseEvent, is_hot: false }];
        expect(formatHotListBlock(events)).to.be.null;
      });

      it('returns null when input is empty', () => {
        expect(formatHotListBlock([])).to.be.null;
      });

      it('renders header + bullets only for hot events', () => {
        const events: CalendarEventResponse[] = [
          { ...baseEvent, id: '1', name: 'Hot one', is_hot: true, hot_reason: 'FOMC' },
          { ...baseEvent, id: '2', name: 'Cold one', is_hot: false },
          { ...baseEvent, id: '3', name: 'Hot two', is_hot: true },
        ];

        const block = formatHotListBlock(events)!;
        expect(block).to.include('🔥 <b>Hot this week</b>');
        expect(block).to.include('Hot one');
        expect(block).to.include('Hot two');
        expect(block).to.not.include('Cold one');
      });

      it('appends hot_reason after em-dash when present', () => {
        const events: CalendarEventResponse[] = [
          { ...baseEvent, name: 'Powell speaks', is_hot: true, hot_reason: 'Post-FOMC presser' },
        ];

        const block = formatHotListBlock(events)!;
        expect(block).to.include('Powell speaks');
        expect(block).to.include('Post-FOMC presser');
      });

      it('escapes HTML in event names and reasons', () => {
        const events: CalendarEventResponse[] = [
          {
            ...baseEvent,
            name: 'Evil <script>alert(1)</script>',
            is_hot: true,
            hot_reason: 'rogue & danger',
          },
        ];

        const block = formatHotListBlock(events)!;
        expect(block).to.not.include('<script>');
        expect(block).to.include('&lt;script&gt;');
        expect(block).to.include('rogue &amp; danger');
      });
    });

    describe('formatWeeklyDigest', () => {
      const cold: CalendarEventResponse = {
        id: '1',
        name: 'Routine Speech',
        date: '2026-05-01',
        time: null,
        end_date: null,
        description: null,
        link: null,
        category: { name: 'Fed/Macro Events', slug: 'fed-macro' },
        is_hot: false,
      };
      const hot: CalendarEventResponse = {
        ...cold,
        id: '2',
        name: 'Big Unlock',
        is_hot: true,
        hot_reason: 'Top unlock this week',
        category: { name: 'Token Unlocks', slug: 'token-unlocks' },
      };

      it('emits the empty-state copy when no events', () => {
        const out = formatWeeklyDigest({ events: [], total: 0 });
        expect(out).to.include('No upcoming events');
      });

      it('puts the hot block above the upcoming list when hot events exist', () => {
        const out = formatWeeklyDigest({ events: [cold, hot], total: 2 });
        const hotIdx = out.indexOf('🔥 <b>Hot this week</b>');
        const upcomingIdx = out.indexOf('Upcoming Events');
        expect(hotIdx).to.be.greaterThan(-1);
        expect(upcomingIdx).to.be.greaterThan(hotIdx);
      });

      it('omits the hot block entirely when no events are flagged', () => {
        const out = formatWeeklyDigest({ events: [cold], total: 1 });
        expect(out).to.not.include('Hot this week');
        expect(out).to.include('Upcoming Events');
      });

      it('prefixes hot events in the upcoming list with the flame', () => {
        const out = formatWeeklyDigest({ events: [hot, cold], total: 2 });
        // The hot event line in the upcoming section should have a flame.
        expect(out).to.include('🔥 📌 <b>Big Unlock</b>');
        expect(out).to.include('📌 <b>Routine Speech</b>');
        // Cold event should not be flame-prefixed.
        expect(out).to.not.include('🔥 📌 <b>Routine Speech</b>');
      });

      it('shows showing X of Y footer when shown < total', () => {
        const out = formatWeeklyDigest({ events: [cold], total: 5 });
        expect(out).to.include('Showing 1 of 5 events');
      });
    });

    describe('parseHotFeedback', () => {
      it('parses helpful verdict with no event id', () => {
        const out = parseHotFeedback('hot_feedback:helpful');
        expect(out).to.deep.equal({ verdict: 'helpful', eventId: undefined, known: true });
      });

      it('parses not_useful verdict with no event id', () => {
        const out = parseHotFeedback('hot_feedback:not_useful');
        expect(out).to.deep.equal({ verdict: 'not_useful', eventId: undefined, known: true });
      });

      it('parses verdict + event id (forward-compat)', () => {
        // Future format: `hot_feedback:<verdict>:<event_id>` for per-event scoring.
        // Pre-fix the slice() approach treated 'helpful:abc-123' as one verdict
        // and logged it as unknown.
        const out = parseHotFeedback('hot_feedback:helpful:evt-abc-123');
        expect(out).to.deep.equal({ verdict: 'helpful', eventId: 'evt-abc-123', known: true });
      });

      it('flags unknown verdicts so handler can warn instead of silently accepting', () => {
        const out = parseHotFeedback('hot_feedback:lukewarm');
        expect(out.verdict).to.equal('lukewarm');
        expect(out.known).to.be.false;
      });

      it('returns known=false for unrecognized prefix', () => {
        const out = parseHotFeedback('something_else:helpful');
        expect(out.known).to.be.false;
      });
    });

    describe('hotFeedbackKeyboard', () => {
      it('returns inline keyboard with helpful and not_useful feedback buttons', () => {
        const keyboard = hotFeedbackKeyboard();
        const buttons = keyboard.reply_markup.inline_keyboard.flat();
        expect(buttons).to.have.lengthOf(2);
        const callbackData = buttons.map((b: { callback_data?: string }) => b.callback_data);
        // Prefix `hot_feedback:` lets the handler dispatch generically and
        // leaves room for `:event_id` suffix in a future iteration.
        expect(callbackData).to.include('hot_feedback:helpful');
        expect(callbackData).to.include('hot_feedback:not_useful');
      });
    });

    describe('chunkForTelegram', () => {
      it('returns single chunk when message fits limit', () => {
        const out = chunkForTelegram('short message', 4000);
        expect(out).to.deep.equal(['short message']);
      });

      it('splits on newlines when message exceeds limit', () => {
        const line = 'x'.repeat(50);
        const message = Array.from({ length: 5 }, () => line).join('\n');
        const chunks = chunkForTelegram(message, 100);
        expect(chunks.length).to.be.greaterThan(1);
        chunks.forEach(c => expect(c.length).to.be.lessThanOrEqual(100));
        // No content lost.
        expect(chunks.join('\n')).to.equal(message);
      });

      it('hard-splits a single overlong line into bounded chunks', () => {
        const message = 'x'.repeat(250);
        const chunks = chunkForTelegram(message, 100);
        expect(chunks.length).to.be.greaterThan(1);
        chunks.forEach(c => expect(c.length).to.be.lessThanOrEqual(100));
        // No content lost for unbroken input.
        expect(chunks.join('')).to.equal(message);
      });

      it('preserves leading and adjacent blank lines on round-trip', () => {
        // Pre-fix bug: `current ? '\n' : ''` swallowed the leading newline
        // because empty string was indistinguishable from "no current chunk".
        const line = 'x'.repeat(50);
        const message = `\n${line}\n\n${line}`;
        const chunks = chunkForTelegram(message, 80);
        expect(chunks.length).to.be.greaterThan(1);
        expect(chunks.join('\n')).to.equal(message);
      });
    });
  });
});
