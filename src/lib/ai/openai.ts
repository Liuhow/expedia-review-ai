import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  if (!client) {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    const opts: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: process.env.OPENAI_API_KEY,
    };
    if (proxy) {
      opts.httpAgent = new HttpsProxyAgent(proxy);
    }
    client = new OpenAI(opts);
  }

  return client;
}

