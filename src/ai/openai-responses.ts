/**
 * Minimal OpenAI Responses API adapter for structured extraction.
 *
 * No SDK, no automatic retries, `store: false`, no tools. Request building,
 * schema adaptation and output parsing are pure so they can be tested without
 * a network or a key. The key never appears in returned text: every raw body
 * is redacted before it leaves this module.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];
export type ImageDetail = "low" | "high" | "original" | "auto";

export type ExtractionRequest = {
  model: string;
  effort: ReasoningEffort | null;
  prompt: string;
  images: { mime: string; data: Uint8Array; detail: ImageDetail }[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  /** Luna accepts a temperature only with reasoning effort `none` (measured 2026-09-22). */
  temperature?: number;
};

/**
 * Structured Outputs in strict mode rejects some JSON Schema keywords. Strip
 * them and report exactly what was removed so the caller can record that the
 * provider did not enforce them natively and validate them after parsing.
 */
const UNSUPPORTED_STRICT_KEYWORDS = new Set(["$schema", "minLength", "maxLength"]);
export function strictSchema(schema: unknown): { schema: Record<string, unknown>; removed: string[] } {
  const removed = new Set<string>();
  const walk = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((x, i) => walk(x, `${path}[${i}]`));
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (UNSUPPORTED_STRICT_KEYWORDS.has(k)) { removed.add(`${path}.${k}`); continue; }
      out[k] = walk(v, `${path}.${k}`);
    }
    return out;
  };
  return { schema: walk(schema, "$") as Record<string, unknown>, removed: [...removed].sort() };
}

export function buildRequestBody(req: ExtractionRequest): Record<string, unknown> {
  if (!req.images.length) throw new Error("extraction needs at least one image");
  const content: Record<string, unknown>[] = [{ type: "input_text", text: req.prompt }];
  for (const img of req.images) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(img.mime)) throw new Error(`unsupported image type ${img.mime}`);
    content.push({ type: "input_image", image_url: `data:${img.mime};base64,${Buffer.from(img.data).toString("base64")}`, detail: img.detail });
  }
  const body: Record<string, unknown> = {
    model: req.model,
    store: false,
    stream: false,
    service_tier: "default",
    max_output_tokens: req.maxOutputTokens,
    text: { format: { type: "json_schema", name: req.schemaName, strict: true, schema: strictSchema(req.schema).schema } },
    input: [{ role: "user", content }],
  };
  if (req.effort !== null) body.reasoning = { effort: req.effort };
  if (req.temperature !== undefined) {
    if (req.effort !== null && req.effort !== "none") throw new Error("temperature is only accepted without reasoning");
    body.temperature = req.temperature;
  }
  return body;
}

/**
 * A 429 rate-limit rejection is refused before processing and is not billed,
 * unlike a timeout or 5xx after the request may have run. Quota exhaustion
 * (`insufficient_quota`) is also a 429 but must stop the caller, not wait.
 */
export function rateLimitWaitMs(httpStatus: number, raw: string): number | null {
  if (httpStatus !== 429) return null;
  let error: any;
  try { error = JSON.parse(raw)?.error; } catch { return null; }
  if (error?.code !== "rate_limit_exceeded") return null;
  const m = /try again in ([\d.]+)\s*(ms|s)\b/i.exec(String(error.message ?? ""));
  const ms = m ? Number(m[1]) * (m[2]!.toLowerCase() === "ms" ? 1 : 1000) : NaN;
  return Math.min(60_000, Math.max(1_000, Number.isFinite(ms) ? Math.ceil(ms) + 250 : 5_000));
}

export type ParsedResponse = {
  id: string | null;
  model: string | null;
  status: string | null;
  incompleteReason: string | null;
  refusal: string | null;
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  } | null;
};

export function parseResponse(data: any): ParsedResponse {
  const parts = (data?.output ?? []).filter((x: any) => x?.type === "message").flatMap((x: any) => x.content ?? []);
  return {
    id: data?.id ?? null,
    model: data?.model ?? null,
    status: data?.status ?? null,
    incompleteReason: data?.incomplete_details?.reason ?? null,
    refusal: parts.find((p: any) => p?.type === "refusal")?.refusal ?? null,
    text: parts.filter((p: any) => p?.type === "output_text").map((p: any) => p.text).join(""),
    usage: data?.usage ?? null,
  };
}

export function redactor(key: string) {
  return (s: string) => (key ? s.split(key).join("[REDACTED]") : s).replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
}

export type CallResult = { httpStatus: number; requestId: string | null; raw: string; elapsedMs: number; data: any | null };

/**
 * One request, no retries. Network failures throw; HTTP errors return with
 * `data: null` so the caller decides how to account the reservation.
 */
export async function postResponses(body: Record<string, unknown>, opts: { apiKey: string; timeoutMs: number; fetchImpl?: typeof fetch; baseUrl?: string }): Promise<CallResult> {
  const redact = redactor(opts.apiKey);
  const started = Date.now();
  const res = await (opts.fetchImpl ?? fetch)(`${opts.baseUrl ?? "https://api.openai.com"}/v1/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(opts.timeoutMs),
    // Bun otherwise applies its own idle timeout to long reasoning requests.
    ...({ timeout: false } as object),
  });
  const raw = redact(await res.text());
  let data: any = null;
  if (res.ok) data = JSON.parse(raw);
  return { httpStatus: res.status, requestId: res.headers.get("x-request-id"), raw, elapsedMs: Date.now() - started, data };
}

/** Reads `NAME=value` from a private env file without logging it. */
export function readEnvValue(text: string, name: string): string | null {
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith(`${name}=`) || new RegExp(`^\\s*${name}\\s*=`).test(l));
  if (!line) return null;
  const value = line.slice(line.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  return value || null;
}
