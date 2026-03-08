import { GoogleGenAI } from "@google/generative-ai";

function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY environment variable is not set");
  }
  return new GoogleGenAI({ apiKey });
}

export async function generateContent(prompt: string): Promise<string> {
  const genAI = getGenAI();
  const response = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
  });
  return response.text ?? "";
}
