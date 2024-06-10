import { expect } from "chai";
import sinon from "sinon";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import {
  truncateStringToTokenCount,
  removeLinksFromMarkdown,
  fetchContentFromURL,
  generateSummary,
  summarizeURL,
} from "../bots/components/ai-summarizer.ts";

const longLoremIpsum = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Etiam enim lorem, varius sit amet mollis tempus, consectetur eu est. Pellentesque bibendum, lacus viverra venenatis gravida, lectus tellus pellentesque enim, sit amet interdum ex sem at justo. Fusce commodo, ex eu porttitor laoreet, eros massa rhoncus sem, quis fermentum magna sem et mi. Integer quis massa lorem. Nullam tempor est nec suscipit dapibus. Nulla facilisi. In ac gravida arcu. Donec velit quam, mattis ut hendrerit at, congue tincidunt in.`;
const truncatedLoremIpsum = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Etiam enim lorem, varius sit amet mollis tempus, consectetur eu est. Pellentesque bibendum, lacus viverra venenatis gravida, lectus tellus pellentesque enim, sit amet interdum ex sem at justo. Fusce commodo, ex eu porttitor laoreet, eros massa rhoncus sem, quis fermentum magna sem et mi. Integer quis massa lorem. Nullam tempor est nec suscipit dapibus. Nulla facilisi. In ac gravida arcu. Donec velit quam, mattis ut hendrerit at, congue ...`;


describe("test: ai-summarizer module", () => {
  describe("test-microfunctions", () => {
    describe("truncateStringToTokenCount", () => {
      it("should truncate a string to the specified number of tokens", () => {
        const result = truncateStringToTokenCount("This is a test string", 3);
        expect(result).to.equal("This is a");
      });

      it("should return the entire string if the token count is greater than the number of tokens in the string", () => {
        const result = truncateStringToTokenCount("This is a test string", 10);
        expect(result).to.equal("This is a test string");
      });

      it("should return an empty string if the input string is empty", () => {
        const result = truncateStringToTokenCount("", 3);
        expect(result).to.equal("");
      });

      it("should return an empty string if the number of tokens is zero", () => {
        const result = truncateStringToTokenCount("This is a test string", 0);
        expect(result).to.equal("");
      });
    });

    describe("removeLinksFromMarkdown", () => {
      it("should remove links from markdown text", () => {
        const result = removeLinksFromMarkdown(
          "This is a [link](http://example.com)"
        );
        expect(result).to.equal("This is a link");
      });

      it("should handle multiple links in markdown text", () => {
        const result = removeLinksFromMarkdown(
          "This [link](http://example.com) and this [another link](http://example2.com)"
        );
        expect(result).to.equal("This link and this another link");
      });

      it("should handle text without links", () => {
        const result = removeLinksFromMarkdown("This is a test string");
        expect(result).to.equal("This is a test string");
      });

      it("should handle empty string", () => {
        const result = removeLinksFromMarkdown("");
        expect(result).to.equal("");
      });
    });
  });
  let axiosMock = new MockAdapter(axios);
  describe("test-fetch URL Content", () => {
    afterEach(() => {
      axiosMock.reset();
      sinon.restore();
    });
    it("should fetch content and process it correctly", async () => {
      const testURL = "http://example.com";
      const testHTML =
        "<html><body><article>Test Article</article></body></html>";
      const expectedMarkdown = "Test Article";

      axiosMock.onGet(testURL).reply(200, testHTML);

      const content = await fetchContentFromURL(testURL);

      expect(content).to.equal(expectedMarkdown);
    });

    it("should throw an error if fetching fails", async () => {
      const testURL = "http://example.com";

      axiosMock.onGet(testURL).networkError();

      try {
        await fetchContentFromURL(testURL);
      } catch (error) {
        expect(error.message).to.equal(
          "Failed to fetch content from URL: Error: Network Error"
        );
      }
    });
  });

  describe("test-summary generation", () => {
    let openAiClientStub;
    beforeEach(() => {
      openAiClientStub = {
        chat: {
          completions: {
            create: sinon.stub(),
          },
        },
      };
    });

    afterEach(() => {
      axiosMock.reset();
      sinon.restore();
    });
    it("errors out on invalid OpenAI client", async () => {
      try {
        await summarizeURL("http://example.com", null);
      } catch (error) {
        expect(error.message).to.equal("Cannot initalise OpenAI client");
      }
    });

    it("handles errors during OpenAI api calls", async () => {
      const testURL = "http://example.com";
      const testHTML =
        "<html><body><article>Test Article</article></body></html>";

      axiosMock.onGet(testURL).reply(200, testHTML);
      openAiClientStub.chat.completions.create.rejects(new Error("API error"));
      try {
        await summarizeURL(testURL, openAiClientStub);
      } catch (error) {
        expect(error.message).to.equal(
          "Failed to summarize URL: Error: Failed to generate summary: Error: API error"
        );
      }
    });
    it("handles successful generation of a summary", async () => {
      const testURL = "http://example.com";
      const testHTML =
        "<html><body><article>Test Article</article></body></html>";
      axiosMock.onGet(testURL).reply(200, testHTML);
      const mockResponse = {
        choices: [{ message: { content: "Generated summary here." } }],
      };
      openAiClientStub.chat.completions.create.resolves(mockResponse);

      const summary = await summarizeURL(testURL, openAiClientStub);
      expect(summary).to.equal("Generated summary here.");
    });
    it("handles string above 500 characters in summary", async () => {
      const testURL = "http://example.com";
      const testHTML =
        "<html><body><article>Test Article</article></body></html>";
      axiosMock.onGet(testURL).reply(200, testHTML);
      const mockResponse = {
        choices: [{ message: { content: longLoremIpsum} }],
      };
      openAiClientStub.chat.completions.create.resolves(mockResponse);

      const summary = await summarizeURL(testURL, openAiClientStub);
      expect(summary.length).to.be.below(501);
      expect(summary).to.equal(truncatedLoremIpsum);
    });
  });
});
