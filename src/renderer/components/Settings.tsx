import { useEffect, useState } from "react";
import type { AiConfigPublic, AiProvider } from "@shared/types";

function ExtensionPairing() {
  const [pairing, setPairing] = useState<{ port: number; token: string } | null>(
    null,
  );
  useEffect(() => {
    void (async () => setPairing(await window.jobwell.getExtensionPairing()))();
  }, []);
  if (!pairing) return null;
  return (
    <div className="job" style={{ display: "block", marginTop: 20 }}>
      <h3>Browser extension pairing</h3>
      <p className="hint">
        Load the <code>extension/</code> folder in Chrome (Extensions → Developer
        mode → Load unpacked), open its popup, and enter these. They reset each
        time JobWell restarts. The extension fills forms but never submits.
      </p>
      <div className="meta">
        <span className="badge">port: {pairing.port}</span>
        <span className="badge">token: {pairing.token}</span>
      </div>
    </div>
  );
}

function Assistant() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    const res = await window.jobwell.askAssistant(q);
    setAnswer(res.text);
    setBusy(false);
  }
  return (
    <div className="job" style={{ display: "block", marginTop: 20 }}>
      <h3>Assistant</h3>
      <p className="hint">
        Answers from your own jobs and resume only. Requires an AI provider
        above. It changes nothing on its own.
      </p>
      <input
        className="filter-input"
        style={{ width: "100%" }}
        value={q}
        placeholder="e.g. Which of my jobs best fit my skills?"
        onChange={(e) => setQ(e.target.value)}
      />
      <button
        className="primary"
        style={{ marginTop: 8 }}
        onClick={ask}
        disabled={busy || !q.trim()}
      >
        {busy ? "Thinking…" : "Ask"}
      </button>
      {answer && <p style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{answer}</p>}
    </div>
  );
}

const PROVIDERS: { value: AiProvider; label: string; needsKey: boolean }[] = [
  { value: "none", label: "Off (no AI)", needsKey: false },
  { value: "deepseek", label: "DeepSeek (your key)", needsKey: true },
  { value: "openai", label: "OpenAI (your key)", needsKey: true },
  { value: "anthropic", label: "Anthropic (your key)", needsKey: true },
  { value: "ollama", label: "Ollama (local)", needsKey: false },
  { value: "lmstudio", label: "LM Studio (local)", needsKey: false },
];

export function Settings() {
  const [cfg, setCfg] = useState<AiConfigPublic | null>(null);
  const [provider, setProvider] = useState<AiProvider>("none");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    void (async () => {
      const c = await window.jobwell.getAiConfig();
      setCfg(c);
      setProvider(c.provider);
      setModel(c.model ?? "");
      setBaseUrl(c.baseUrl ?? "");
    })();
  }, []);

  const current = PROVIDERS.find((p) => p.value === provider);

  async function save() {
    const next = await window.jobwell.setAiConfig({
      provider,
      model: model || undefined,
      baseUrl: baseUrl || undefined,
      // Only send a key if the user typed one; empty string clears it.
      apiKey: apiKey.length > 0 ? apiKey : undefined,
    });
    setCfg(next);
    setApiKey("");
    setSaved("Saved.");
    setTimeout(() => setSaved(""), 2000);
  }

  return (
    <div className="form">
      <h2>AI settings</h2>
      <p className="hint">
        AI is optional. Search, filters, match scores and the tracker never use
        it. Only resume tailoring, cover letters and the assistant do. Local
        options keep everything on your machine; cloud options use your own key,
        stored encrypted in Windows and never shown again.
      </p>

      <label>
        Provider
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as AiProvider)}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {provider !== "none" && (
        <>
          <label>
            Model
            <input
              value={model}
              placeholder={
                provider === "openai"
                  ? "gpt-4o-mini"
                  : provider === "deepseek"
                    ? "deepseek-chat"
                    : provider === "anthropic"
                      ? "claude-3-5-haiku-latest"
                      : "llama3"
              }
              onChange={(e) => setModel(e.target.value)}
            />
          </label>

          {(provider === "ollama" ||
            provider === "lmstudio" ||
            provider === "openai" ||
            provider === "deepseek") && (
            <label>
              Base URL (optional)
              <input
                value={baseUrl}
                placeholder={
                  provider === "ollama"
                    ? "http://127.0.0.1:11434"
                    : provider === "lmstudio"
                      ? "http://127.0.0.1:1234"
                      : provider === "deepseek"
                        ? "https://api.deepseek.com"
                        : "https://api.openai.com"
                }
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
          )}

          {current?.needsKey && (
            <label>
              API key {cfg?.hasKey ? "(stored — leave blank to keep)" : ""}
              <input
                type="password"
                value={apiKey}
                placeholder={cfg?.hasKey ? "••••••••" : "paste key"}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          )}
        </>
      )}

      <div className="row">
        <button className="primary" onClick={save}>
          Save settings
        </button>
        <span className="hint">{saved}</span>
      </div>

      <Assistant />
      <ExtensionPairing />
    </div>
  );
}
