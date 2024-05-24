import OpenAI from "openai"
import { ChatCompletionCreateParamsNonStreaming } from "openai/resources/index.mjs"
import { ReadsConfig } from "./reads.js"

export const fetchUrlSummary = async (url: string, config: ReadsConfig) => {
    const openai = new OpenAI({ apiKey: config.openaiApi })
  
    if (url.trim().length === 0) {
      throw new Error("please enter a valid url")
    }
    try {
      const chatInput: ChatCompletionCreateParamsNonStreaming = {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant.",
          },
          {
            role: "user",
            content:
              "Can you help create a 500 word summary of the following url?",
          },
        ],
        temperature: 0.4,
      }
  
      const res = await openai.chat.completions.create(chatInput)

      return res.choices[1].message.content
    } catch (err) {
      console.log(`received ${err} fetching url summary for ${url}`);
      throw new Error("fetch url summary error")
    }
  }