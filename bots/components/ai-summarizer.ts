import { OpenAI } from "openai";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { NodeHtmlMarkdown } from "node-html-markdown";
import axios from "axios";

export function truncateStringToTokenCount(str, num) {
  return str.split(/\s+/).slice(0, num).join(" ");
}
export function removeLinksFromMarkdown(text) {
  // Replace all link occurrences with the link text
  let regex = /\[([^\]]+)]\(([^)]+)\)/g;
  text = text.replace(regex, "$1");

  return text;
}
/**
 * Fetches the content of a given URL.
 * @param url The URL to fetch the content from.
 * @returns The text content of the URL.
 */
export async function fetchContentFromURL(url: string): Promise<string> {
  try {
    const response = await axios.get(url);
    const content = response.data;
    const virtualConsole = new VirtualConsole();
    const doc = new JSDOM(content, { virtualConsole });

    const reader = new Readability(doc.window.document);
    const article = reader.parse();
    const contentMarkdown = NodeHtmlMarkdown.translate(article.content);

    const markdown = removeLinksFromMarkdown(contentMarkdown);

    const truncatedString = truncateStringToTokenCount(markdown, 2500);
    return truncatedString;
  } catch (error) {
    throw new Error(`Failed to fetch content from URL: ${error}`);
  }
}

/**
 * Generates a summary using OpenAI API.
 * @param content The content to summarize.
 * @returns A summary of the content.
 */
export async function generateSummary(
  content: string,
  openaiClient: OpenAI
): Promise<string> {
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content:
            "Can you help create a summary under 500 characters of the following webpage?",
        },
        { role: "user", content: "The article is formatted as markdown." },
        {
          role: "user",
          content: `The article is as follows: \n${content}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 150, // 500 characters/4 characters per token + 50 (approximation)
    });
    let summary = response.choices[0].message.content.trim();
    if (summary.length > 500) {
      summary = summary.substring(0, 497) + "...";
    }
    return summary;
  } catch (error) {
    throw new Error(`Failed to generate summary: ${error}`);
  }
}

/**
 * Generates a summary for the content at the given URL.
 * @param url The URL to summarize content from.
 * @returns A summary of the content at the URL.
 */
export async function summarizeURL(
  url: string,
  openaiClient: OpenAI
): Promise<string> {
  if (!openaiClient) {
    throw new Error(`Cannot initalise OpenAI client`);
  }
  try {
    const content = await fetchContentFromURL(url);
    const summary = await generateSummary(content, openaiClient);
    return summary;
  } catch (error) {
    throw new Error(`Failed to summarize URL: ${error}`);
  }
}
