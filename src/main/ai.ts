import { app, safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { AiProvider, AiResult } from "@shared/types";

// Secrets are encrypted with the OS key store (DPAPI on Windows) via Electron's
// safeStorage and written to an opaque file. The plaintext key never touches
// the SQLite DB and is never returned to the renderer.
function keyFile(): string {
  return join(app.getPath("userData"), "ai.key.enc");
}

export function hasApiKey(): boolean {
  return existsSync(keyFile());
}

export function storeApiKey(key: string): void {
  if (!key) {
    clearApiKey();
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS secure storage is unavailable; cannot store API key.");
  }
  const enc = safeStorage.encryptString(key);
  writeFileSync(keyFile(), enc);
}

export function clearApiKey(): void {
  if (existsSync(keyFile())) unlinkSync(keyFile());
}

function readApiKey(): string | null {
  if (!existsSync(keyFile())) return null;
  try {
    const buf = readFileSync(keyFile());
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

interface ChatParams {
  provider: AiProvider;
  model: string | null;
  baseUrl: string | null;
  system: string;
  user: string;
}

// A single entry point that routes to the configured provider. Local providers
// (ollama, lmstudio) need no key; cloud providers read the encrypted key.
export async function chat(params: ChatParams): Promise<AiResult> {
  const { provider } = params;
  try {
    switch (provider) {
      case "none":
        return {
          ok: false,
          usedProvider: "none",
          text: "No AI provider is configured. Set one in Settings to use this feature.",
        };
      case "ollama":
        return await chatOllama(params);
      case "lmstudio":
        return await chatOpenAiCompatible(params, null);
      case "openai":
        return await chatOpenAiCompatible(params, readApiKey());
      case "deepseek":
        // DeepSeek is OpenAI-compatible; route through the same path with
        // DeepSeek defaults (base URL + model) applied below.
        return await chatOpenAiCompatible(params, readApiKey());
      case "anthropic":
        return await chatAnthropic(params, readApiKey());
      default:
        return { ok: false, usedProvider: provider, text: "Unknown provider." };
    }
  } catch (err) {
    return {
      ok: false,
      usedProvider: provider,
      text: `AI request failed: ${String(err)}`,
    };
  }
}

async function chatOllama(p: ChatParams): Promise<AiResult> {
  const base = p.baseUrl ?? "http://127.0.0.1:11434";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: p.model ?? "llama3",
      stream: false,
      messages: [
        { role: "system", content: p.system },
        { role: "user", content: p.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return {
    ok: true,
    usedProvider: "ollama",
    text: data.message?.content ?? "",
  };
}

// Works for LM Studio, OpenAI, and DeepSeek — all expose /v1/chat/completions
// with Bearer auth. Per-provider defaults (base URL, model, whether a key is
// required) are applied here.
const OPENAI_COMPATIBLE_DEFAULTS: Record<
  string,
  { base: string; model: string; needsKey: boolean }
> = {
  openai: { base: "https://api.openai.com", model: "gpt-4o-mini", needsKey: true },
  deepseek: {
    base: "https://api.deepseek.com",
    model: "deepseek-chat",
    needsKey: true,
  },
  lmstudio: { base: "http://127.0.0.1:1234", model: "local-model", needsKey: false },
};

async function chatOpenAiCompatible(
  p: ChatParams,
  key: string | null,
): Promise<AiResult> {
  const defaults =
    OPENAI_COMPATIBLE_DEFAULTS[p.provider] ??
    OPENAI_COMPATIBLE_DEFAULTS.lmstudio;
  const base = p.baseUrl ?? defaults.base;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  if (defaults.needsKey && !key) {
    return {
      ok: false,
      usedProvider: p.provider,
      text: `${p.provider} selected but no API key is stored. Add one in Settings.`,
    };
  }
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: p.model ?? defaults.model,
      messages: [
        { role: "system", content: p.system },
        { role: "user", content: p.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${p.provider} HTTP ${res.status}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return {
    ok: true,
    usedProvider: p.provider,
    text: data.choices?.[0]?.message?.content ?? "",
  };
}

async function chatAnthropic(
  p: ChatParams,
  key: string | null,
): Promise<AiResult> {
  if (!key) {
    return {
      ok: false,
      usedProvider: "anthropic",
      text: "Anthropic selected but no API key is stored. Add one in Settings.",
    };
  }
  const base = p.baseUrl ?? "https://api.anthropic.com";
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model ?? "claude-3-5-haiku-latest",
      max_tokens: 1024,
      system: p.system,
      messages: [{ role: "user", content: p.user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = (await res.json()) as {
    content?: { text?: string }[];
  };
  return {
    ok: true,
    usedProvider: "anthropic",
    text: data.content?.map((c) => c.text ?? "").join("") ?? "",
  };
}
