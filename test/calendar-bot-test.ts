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
  createEvent,
  type CalendarBotConfig,
  type CalendarEventDraft,
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
  });
});
