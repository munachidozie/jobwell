import { useEffect, useState } from "react";
import type { BoardProvider, JobSourceDTO } from "@shared/types";
import { isFeedProvider } from "@shared/types";

// Providers the user can add, grouped so the UI can explain each. Feed
// providers need no slug; ATS providers need the company's board slug.
const PROVIDERS: { value: BoardProvider; label: string; hint: string }[] = [
  { value: "remoteok", label: "RemoteOK (feed)", hint: "Global remote jobs. No slug needed." },
  { value: "remotive", label: "Remotive (feed)", hint: "Global remote jobs. No slug needed." },
  { value: "greenhouse", label: "Greenhouse", hint: "Company slug, e.g. 'stripe' (boards.greenhouse.io/stripe)." },
  { value: "lever", label: "Lever", hint: "Company slug, e.g. 'netflix' (jobs.lever.co/netflix)." },
  { value: "ashby", label: "Ashby", hint: "Company slug, e.g. 'ramp' (jobs.ashbyhq.com/ramp)." },
  { value: "workable", label: "Workable", hint: "Company account slug." },
  { value: "recruitee", label: "Recruitee", hint: "Company slug (<slug>.recruitee.com)." },
  {
    value: "custom",
    label: "Custom (RSS / JSON)",
    hint: "Add any public RSS/Atom feed or JSON jobs endpoint (https only). Respects robots.txt; blocked hosts are refused.",
  },
];

export function Sources({ onChanged }: { onChanged: () => void }) {
  const [sources, setSources] = useState<JobSourceDTO[]>([]);
  const [provider, setProvider] = useState<BoardProvider>("greenhouse");
  const [board, setBoard] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Custom (RSS/JSON) source fields.
  const [cName, setCName] = useState("");
  const [cUrl, setCUrl] = useState("");
  const [cFormat, setCFormat] = useState<"rss" | "json">("rss");
  const [cItemsPath, setCItemsPath] = useState("");
  const [cTitle, setCTitle] = useState("title");
  const [cCompany, setCCompany] = useState("company");
  const [cLocation, setCLocation] = useState("location");
  const [cUrlField, setCUrlField] = useState("url");
  const [cDesc, setCDesc] = useState("description");

  async function load() {
    setSources(await window.jobwell.listJobSources());
  }
  useEffect(() => {
    void load();
  }, []);

  const current = PROVIDERS.find((p) => p.value === provider);
  const isCustom = provider === "custom";
  const needsSlug = !isCustom && !isFeedProvider(provider);

  async function add() {
    if (isCustom) return addCustom();
    const slug = needsSlug ? board.trim().toLowerCase() : "feed";
    if (needsSlug && !slug) {
      setMsg("Enter the company slug for this provider.");
      return;
    }
    setBusy(true);
    await window.jobwell.addJobSource({
      provider,
      board: slug,
      label: needsSlug ? `${current?.label}: ${slug}` : current?.label ?? slug,
      enabled: true,
    });
    setBusy(false);
    setBoard("");
    setMsg("Added.");
    await load();
    onChanged();
    setTimeout(() => setMsg(""), 2000);
  }

  async function addCustom() {
    const name = cName.trim();
    if (!name) {
      setMsg("Give the custom source a name.");
      return;
    }
    const cfg = {
      url: cUrl.trim(),
      format: cFormat,
      ...(cFormat === "json"
        ? {
            mapping: {
              itemsPath: cItemsPath.trim(),
              title: cTitle.trim() || "title",
              company: cCompany.trim() || undefined,
              location: cLocation.trim() || undefined,
              url: cUrlField.trim() || undefined,
              description: cDesc.trim() || undefined,
            },
          }
        : {}),
    };
    // Validate in the main process (shared validator) before saving.
    const v = await window.jobwell.validateCustomSource(cfg);
    if (!v.ok) {
      setMsg(v.error ?? "Invalid custom source.");
      return;
    }
    setBusy(true);
    // board = a stable key derived from the name; also the job-id namespace.
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await window.jobwell.addJobSource({
      provider: "custom",
      board: key,
      label: name,
      enabled: true,
      custom: cfg,
    });
    setBusy(false);
    setCName("");
    setCUrl("");
    setMsg("Custom source added.");
    await load();
    onChanged();
    setTimeout(() => setMsg(""), 2500);
  }

  async function toggle(s: JobSourceDTO) {
    await window.jobwell.addJobSource({
      provider: s.provider,
      board: s.board,
      label: s.label,
      enabled: !s.enabled,
    });
    await load();
    onChanged();
  }

  async function remove(id: number) {
    await window.jobwell.deleteJobSource(id);
    await load();
    onChanged();
  }

  return (
    <div className="form" style={{ maxWidth: 720 }}>
      <h2>Job sources</h2>
      <p className="hint">
        These are the boards "Refresh jobs" pulls from. Feeds (RemoteOK,
        Remotive) return many employers' remote roles with no slug. For a
        specific company, add its ATS board with the company slug.
      </p>

      <div className="job" style={{ display: "block" }}>
        <h3>Add a source</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <select
            className="status-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value as BoardProvider)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {needsSlug && (
            <input
              className="filter-input"
              placeholder="company slug, e.g. stripe"
              value={board}
              onChange={(e) => setBoard(e.target.value)}
            />
          )}
          {!isCustom && (
            <button className="primary" onClick={add} disabled={busy}>
              {busy ? "Adding…" : "Add"}
            </button>
          )}
          <span className="hint">{msg}</span>
        </div>
        <p className="hint">{current?.hint}</p>

        {isCustom && (
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <input
              className="filter-input"
              placeholder="Name (e.g. CryptoJobsList)"
              value={cName}
              onChange={(e) => setCName(e.target.value)}
            />
            <input
              className="filter-input"
              placeholder="Feed/endpoint URL (https://…)"
              value={cUrl}
              onChange={(e) => setCUrl(e.target.value)}
            />
            <div className="row" style={{ gap: 8 }}>
              <label className="hint">
                Format
                <select
                  className="status-select"
                  value={cFormat}
                  onChange={(e) => setCFormat(e.target.value as "rss" | "json")}
                >
                  <option value="rss">RSS / Atom</option>
                  <option value="json">JSON</option>
                </select>
              </label>
            </div>
            {cFormat === "json" && (
              <>
                <p className="hint">
                  JSON field mapping — dot-paths into the response. Leave
                  "items path" blank if the response is itself the array.
                </p>
                <input className="filter-input" placeholder="items path (e.g. jobs or data.results)" value={cItemsPath} onChange={(e) => setCItemsPath(e.target.value)} />
                <input className="filter-input" placeholder="title field (required)" value={cTitle} onChange={(e) => setCTitle(e.target.value)} />
                <input className="filter-input" placeholder="company field" value={cCompany} onChange={(e) => setCCompany(e.target.value)} />
                <input className="filter-input" placeholder="location field" value={cLocation} onChange={(e) => setCLocation(e.target.value)} />
                <input className="filter-input" placeholder="url field" value={cUrlField} onChange={(e) => setCUrlField(e.target.value)} />
                <input className="filter-input" placeholder="description field" value={cDesc} onChange={(e) => setCDesc(e.target.value)} />
              </>
            )}
            <div>
              <button className="primary" onClick={add} disabled={busy}>
                {busy ? "Adding…" : "Add custom source"}
              </button>
            </div>
          </div>
        )}
      </div>

      <h3>Your sources ({sources.length})</h3>
      {sources.length === 0 && (
        <p className="hint">No sources yet. Add one above.</p>
      )}
      {sources.map((s) => (
        <div className="saved-item" key={s.id}>
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={() => toggle(s)}
            title={s.enabled ? "Enabled — included in refresh" : "Disabled"}
          />
          <span style={{ fontWeight: 600 }}>
            {s.label ?? `${s.provider}:${s.board}`}
          </span>
          <span className="badge">{s.provider}</span>
          {!isFeedProvider(s.provider as BoardProvider) && (
            <span className="badge">{s.board}</span>
          )}
          <span className="spacer" />
          <button className="tab danger" onClick={() => remove(s.id)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
