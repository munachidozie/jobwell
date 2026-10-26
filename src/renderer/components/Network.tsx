import { useEffect, useState } from "react";
import type { AiResult } from "@shared/types";
import type { Contact, RankedContact } from "@shared/contacts";
import { displayName } from "@shared/contacts";

// Nudge the user to refresh their connections export after this many days.
const REIMPORT_AFTER_DAYS = 60;

// Most recent importedAt across all contacts, or null if none.
function lastImportedAt(contacts: Contact[]): string | null {
  let latest: string | null = null;
  for (const c of contacts) {
    if (c.importedAt && (!latest || c.importedAt > latest)) latest = c.importedAt;
  }
  return latest;
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return ms > 0 ? ms / (1000 * 60 * 60 * 24) : 0;
}

export function Network() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [ranked, setRanked] = useState<RankedContact[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>("");
  // Outreach draft state, keyed by contact id.
  const [drafts, setDrafts] = useState<Record<number, AiResult | null>>({});
  const [draftBusy, setDraftBusy] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function load() {
    const [c, r] = await Promise.all([
      window.jobwell.listContacts(),
      window.jobwell.whoToMessage(),
    ]);
    setContacts(c);
    setRanked(r);
  }

  useEffect(() => {
    void load();
  }, []);

  async function importCsv(mode: "replace" | "merge") {
    setBusy(true);
    setNote("");
    try {
      const res = await window.jobwell.importContacts(mode);
      if (!res) {
        setNote("Import cancelled.");
        return;
      }
      reportImport(res, mode);
      await load();
    } catch (e) {
      setNote(`Import failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function reportImport(
    res: { stored: number; notes: string[] },
    mode: "replace" | "merge",
  ) {
    setNote(
      `${res.stored} connection(s) ${mode === "replace" ? "imported" : "added"}. ${res.notes.join(" ")}`,
    );
  }

  // Drag-and-drop: read the dropped .csv's text in the renderer and import it
  // without a file dialog. A dropped file replaces the set (same as Re-import).
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setNote("That doesn't look like a .csv file. Drop your Connections.csv.");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const text = await file.text();
      const res = await window.jobwell.importContactsFromText(text, "replace");
      reportImport(res, "replace");
      await load();
    } catch (err) {
      setNote(`Import failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeContact(id: number) {
    await window.jobwell.deleteContact(id);
    await load();
  }

  async function clearAll() {
    await window.jobwell.clearContacts();
    setConfirmClear(false);
    setDrafts({});
    await load();
  }

  async function draft(contactId: number) {
    setDraftBusy(contactId);
    try {
      const res = await window.jobwell.draftOutreach(contactId);
      setDrafts((d) => ({ ...d, [contactId]: res }));
    } catch (e) {
      setDrafts((d) => ({
        ...d,
        [contactId]: { ok: false, text: String(e), usedProvider: "none" },
      }));
    } finally {
      setDraftBusy(null);
    }
  }

  async function copyDraft(contactId: number) {
    const text = drafts[contactId]?.text;
    if (text) await navigator.clipboard.writeText(text);
  }

  if (contacts.length === 0) {
    return (
      <div className="empty">
        <p>No connections imported yet.</p>
        <p className="hint">
          Export your connections from LinkedIn (Settings → Data Privacy → Get a
          copy of your data → Connections), then import the{" "}
          <code>Connections.csv</code> here. It stays on your machine — nothing
          is uploaded.
        </p>
        <div
          className={`dropzone ${dragOver ? "dragover" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          Drag your <code>Connections.csv</code> here
          <div className="hint" style={{ marginTop: 6 }}>
            or
          </div>
          <button
            className="primary"
            style={{ marginTop: 6 }}
            onClick={() => importCsv("replace")}
            disabled={busy}
          >
            {busy ? "Importing…" : "Choose file…"}
          </button>
        </div>
        {note && (
          <p className="hint" style={{ marginTop: 10 }}>
            {note}
          </p>
        )}
      </div>
    );
  }

  const lastImport = lastImportedAt(contacts);
  const staleDays = lastImport ? daysSince(lastImport) : 0;
  const showReimportNudge = lastImport !== null && staleDays >= REIMPORT_AFTER_DAYS;

  return (
    <div
      className={`form ${dragOver ? "drag-active" : ""}`}
      style={{ maxWidth: 820 }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the panel entirely, not child elements.
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {showReimportNudge && (
        <div className="truth-warn" style={{ marginBottom: 12 }}>
          ⏰ Your connections were last imported {Math.round(staleDays)} days
          ago. LinkedIn connections drift over time — re-import a fresh{" "}
          <code>Connections.csv</code> to keep "who to message" current.
        </div>
      )}
      {dragOver && (
        <p className="hint" style={{ color: "var(--good)" }}>
          Drop your Connections.csv to replace the current set…
        </p>
      )}
      <div className="row">
        <h2 style={{ flex: 1 }}>Network ({contacts.length} connections)</h2>
        <button
          className="tab"
          onClick={() => importCsv("merge")}
          disabled={busy}
        >
          Add more
        </button>
        <button
          className="primary"
          onClick={() => importCsv("replace")}
          disabled={busy}
        >
          {busy ? "Importing…" : "Re-import"}
        </button>
        {confirmClear ? (
          <>
            <button className="link-danger" onClick={clearAll}>
              Confirm clear
            </button>
            <button className="tab" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="tab" onClick={() => setConfirmClear(true)}>
            Clear all
          </button>
        )}
      </div>
      {note && <p className="hint">{note}</p>}

      <h3>Who to message</h3>
      <p className="hint">
        Ranked by how well they map to the companies you're pursuing (from your
        Tracker) and your target role. Drafts use only facts from your resume —
        they never invent a shared history.
      </p>

      {ranked.length === 0 ? (
        <p className="hint">
          No strong matches yet. Track a few jobs (Feed → set a status) so
          JobWell knows which companies you're after, then come back.
        </p>
      ) : (
        ranked.map(({ contact, score, reasons, matchedCompany }) => {
          const d = drafts[contact.id];
          return (
            <div className="job" key={contact.id} style={{ display: "block" }}>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <h3>
                    {contact.profileUrl ? (
                      <a
                        href={contact.profileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {displayName(contact)}
                      </a>
                    ) : (
                      displayName(contact)
                    )}
                  </h3>
                  <div className="meta">
                    {contact.position && (
                      <span className="badge">{contact.position}</span>
                    )}
                    {contact.company && (
                      <span className="badge">{contact.company}</span>
                    )}
                    {matchedCompany && (
                      <span className="badge" style={{ color: "var(--strong)" }}>
                        🎯 target
                      </span>
                    )}
                  </div>
                  <ul className="hint" style={{ margin: "6px 0 0" }}>
                    {reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="score">
                  <div className="pct">{score}</div>
                  <button
                    className="tab"
                    onClick={() => draft(contact.id)}
                    disabled={draftBusy === contact.id}
                  >
                    {draftBusy === contact.id ? "Drafting…" : "Draft message"}
                  </button>
                  <button
                    className="link-danger"
                    onClick={() => removeContact(contact.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {d && (
                <div style={{ marginTop: 10 }}>
                  {d.ok ? (
                    <>
                      <textarea
                        className="letter-text"
                        value={d.text}
                        readOnly
                        rows={6}
                      />
                      {d.truthViolations && d.truthViolations.length > 0 && (
                        <p className="truth-warn" style={{ marginTop: 6 }}>
                          ⚠️ The draft mentions things not in your resume (
                          {d.truthViolations.map((v) => v.value).join(", ")}).
                          Edit before sending.
                        </p>
                      )}
                      <div className="row" style={{ marginTop: 6 }}>
                        <button
                          className="tab"
                          onClick={() => copyDraft(contact.id)}
                        >
                          Copy
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="hint" style={{ color: "var(--danger)" }}>
                      {d.text || "Couldn't draft a message."} Configure an AI
                      provider in Settings to enable drafts.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
