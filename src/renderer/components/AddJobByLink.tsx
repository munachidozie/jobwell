import { useState } from "react";
import type { ResolveLinkResult } from "@shared/types";

// "Add a job by link": paste a URL for a role found outside the app. The main
// process resolves it (known board / JSON-LD / heuristic), we show a confirm +
// edit form, save it as a first-class job, and optionally offer to register the
// site as a recurring source.
export function AddJobByLink({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [resolved, setResolved] = useState<ResolveLinkResult | null>(null);
  const [awaitingRecurring, setAwaitingRecurring] = useState(false);

  // Editable confirm fields, prefilled from the resolver's draft/job.
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  function reset() {
    setResolved(null);
    setTitle("");
    setCompany("");
    setLocation("");
    setDescription("");
  }

  function closeAll() {
    setOpen(false);
    setUrl("");
    setMsg("");
    setAwaitingRecurring(false);
    reset();
  }

  async function resolve() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    setMsg("Reading the link…");
    reset();
    try {
      const res = await window.jobwell.resolveJobLink(trimmed);
      setResolved(res);
      setMsg(res.message);
      // Prefill the confirm form from a full job or a draft.
      const src = res.job ?? res.draft;
      if (src) {
        setTitle(src.title ?? "");
        setCompany(src.company ?? "");
        setLocation(src.location ?? "");
        setDescription(src.description ?? "");
      }
    } catch (e) {
      setMsg(`Couldn't read that link: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!title.trim()) {
      setMsg("A title is required to add the job.");
      return;
    }
    setBusy(true);
    try {
      const res = await window.jobwell.addManualJob({
        url: url.trim(),
        title,
        company,
        location,
        description,
      });
      // Offer to register the site as a recurring source, if the resolver
      // suggested one (non-blocked, non-known-board host).
      const suggestion = resolved?.recurringSuggestion ?? null;
      if (suggestion) {
        setMsg(
          res.added
            ? "Job added to your feed."
            : "That job was already in your feed (updated).",
        );
        // Keep the panel open to show the recurring-source offer.
        setResolved((r) => (r ? { ...r } : r));
        setAwaitingRecurring(true);
      } else {
        setMsg(res.added ? "Job added to your feed." : "That job was already in your feed.");
        onAdded();
        closeAll();
      }
    } catch (e) {
      setMsg(`Couldn't add the job: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function addRecurring(yes: boolean) {
    const suggestion = resolved?.recurringSuggestion;
    if (yes && suggestion) {
      setBusy(true);
      try {
        const r = await window.jobwell.registerSiteAsSource({
          url: suggestion.url,
          label: suggestion.host,
        });
        setMsg(
          r.added
            ? `Added ${suggestion.host} as a recurring source. Tune it in the Sources tab if needed.`
            : `Couldn't add the source: ${r.error ?? "unknown error"}.`,
        );
      } catch (e) {
        setMsg(`Couldn't add the source: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    }
    setAwaitingRecurring(false);
    onAdded();
    // Leave the final message visible briefly; close the editor state.
    reset();
    setUrl("");
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 12 }}>
        <button className="tab" onClick={() => setOpen(true)}>
          ➕ Add job by link
        </button>
      </div>
    );
  }

  return (
    <div className="job" style={{ display: "block", marginBottom: 12 }}>
      <div className="row">
        <h3 style={{ flex: 1 }}>Add a job by link</h3>
        <button className="tab" onClick={closeAll}>
          Close
        </button>
      </div>
      <p className="hint">
        Paste a link to a role you found elsewhere. JobWell reads what it can;
        you confirm the details, and it joins your feed like any other job.
      </p>

      <div className="row" style={{ gap: 8 }}>
        <input
          className="filter-input"
          style={{ flex: 1 }}
          placeholder="https://… job posting URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void resolve();
          }}
          autoFocus
        />
        <button className="primary" onClick={resolve} disabled={busy || !url.trim()}>
          {busy ? "Reading…" : "Read link"}
        </button>
      </div>

      {msg && <p className="hint" style={{ marginTop: 8 }}>{msg}</p>}

      {/* Confirm / edit form, shown once we've attempted a resolve. */}
      {resolved && !awaitingRecurring && (
        <div style={{ marginTop: 10 }}>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Company
            <input value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label>
            Location
            <input
              value={location}
              placeholder="e.g. Remote, or Lagos"
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button
              className="primary"
              onClick={save}
              disabled={busy || !title.trim()}
            >
              Add to feed
            </button>
            <button className="tab" onClick={closeAll}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Optional: register the site as a recurring source after saving. */}
      {awaitingRecurring && resolved?.recurringSuggestion && (
        <div className="truth-warn" style={{ marginTop: 10 }}>
          <strong>
            Also track {resolved.recurringSuggestion.host} as a recurring source?
          </strong>
          <p className="hint" style={{ marginTop: 4 }}>
            JobWell will try to pull new jobs from this site on future refreshes.
            It may need tuning in the Sources tab (the exact feed format can't be
            guessed from a single page). You can remove it anytime.
          </p>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button className="primary" onClick={() => addRecurring(true)} disabled={busy}>
              Yes, add as a source
            </button>
            <button className="tab" onClick={() => addRecurring(false)} disabled={busy}>
              No, just this job
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
