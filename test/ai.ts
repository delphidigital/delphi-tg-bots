import { before, describe, it } from 'mocha';
import { fetchUrlSummary } from '../bots/ai.js';
import { ReadsConfig } from '../bots/reads.js';
import { expect } from 'chai';

describe(('Fetching URL Summary'), () => {
    let config: ReadsConfig
    before(() => {
        config = {
            botToken: '',
            openaiApi: process.env.OPENAI_API_KEY,
            delphiApi: {apiKey: '', baseUrl: '', readingListId: ''}
        }
    })

    it('Fetch the valid url summary', async () => {
        const summary = await fetchUrlSummary('https://vercel.com/', config)

        expect(summary).to.not.be('')
    })

    it('Fetch the invalid url summary', async () => {
        const summary = await fetchUrlSummary('asdf', config)

        expect(summary).to.include('cannot')
    })
})