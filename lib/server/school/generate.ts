/**
 * One LLM call that must come back as JSON, for the Teacher Studio generators
 * (question bank, question paper). Model resolution follows the other routes:
 * the client's `x-model` headers, with the server-managed key when the
 * provider is configured on the server.
 */
import type { NextRequest } from 'next/server';
import { parseJsonResponse } from '@openmaic/generation';

import { callLLM } from '@/lib/ai/llm';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';

/** The model call failed; the message is safe to show the teacher. */
export class GenerationError extends Error {}

export async function generateJson<T>(
  req: NextRequest,
  body: Record<string, unknown>,
  source: string,
  system: string,
  prompt: string,
): Promise<T | null> {
  const { model, thinkingConfig, serverManaged } = await resolveModelFromRequest(req, body);
  let result;
  try {
    result = await callLLM({ model, system, prompt }, source, undefined, thinkingConfig, {
      serverManaged,
    });
  } catch (error) {
    throw new GenerationError(error instanceof Error ? error.message : String(error));
  }
  return parseJsonResponse<T>(result.text);
}

export const QUESTION_JSON_CONTRACT = `Each question is a JSON object:
{
  "type": "mcq" | "true_false" | "fill_blank" | "short" | "long",
  "text": "the question as the student reads it (use ____ for a blank)",
  "options": ["A", "B", "C", "D"]        // mcq only, exactly 4 options, no letters prefixed
  "answer": 0,                           // mcq: 0-based index of the correct option
                                         // true_false: "True" or "False"
                                         // others: the model answer / marking points
  "explanation": "one or two sentences on why",
  "marks": 1,
  "difficulty": "easy" | "medium" | "hard"
}
Rules: questions must be answerable from the chapter content at that class level, factually correct, unambiguous, with exactly one correct option for mcq. Use the board's exam phrasing. Never number the questions inside "text". Return JSON only, no markdown fences, no commentary.`;
