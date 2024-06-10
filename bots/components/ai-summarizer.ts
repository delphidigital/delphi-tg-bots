import openAI from "openai";
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
  openaiKey: string
): Promise<string> {
  const openai = new openAI({
    apiKey: openaiKey,
    baseURL: "http://localhost:4891/v1",
  });
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content:
            "Can you help create a summary under 500 character of the following webpage?",
        },
        { role: "user", content: "The article is formatted as markdown." },
        {
          role: "user",
          content: `The article is as follows: \n${content}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 125, // 500 characters/4 characters per token (approximation)
    });
    console.log(response.choices[0]);
    return response.choices[0].message.content.trim();
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
  openaiKey: string
): Promise<string> {
  try {
    const content = await fetchContentFromURL(url);
    const summary = await generateSummary(content, openaiKey);
    return summary;
  } catch (error) {
    throw new Error(`Failed to summarize URL: ${error}`);
  }
}
