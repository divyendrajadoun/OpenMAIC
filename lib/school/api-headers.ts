'use client';

import { getCurrentModelConfig, getStageRoutesHeaderValue } from '@/lib/utils/model-config';

/**
 * Headers for a JSON POST to a route that calls the LLM: the same model
 * headers the quiz grader sends, so a server-managed provider is used when the
 * deployment has one and the user's own choice otherwise.
 */
export function llmRequestHeaders(): Record<string, string> {
  const modelConfig = getCurrentModelConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-model': modelConfig.modelString,
    'x-api-key': modelConfig.apiKey,
  };
  if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
  if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;
  const stageRoutes = getStageRoutesHeaderValue();
  if (stageRoutes) headers['x-model-routes'] = stageRoutes;
  return headers;
}

/** Fetch JSON from a school route; throws with the server's message on failure. */
export async function schoolFetch<T>(
  url: string,
  init: { method?: string; body?: unknown; llm?: boolean } = {},
): Promise<T> {
  const headers = init.llm ? llmRequestHeaders() : { 'Content-Type': 'application/json' };
  const res = await fetch(url, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    cache: 'no-store',
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}
