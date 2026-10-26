import { useState } from "react";

// Data & backup panel: encrypted/plain export, import (with an in-app passphrase
// field for encrypted files), and delete-all-data. Electron renderers do NOT
// support window.prompt/confirm/alert — so all prompts here are real in-UI
// inputs, never browser dialogs.
export function DataBackup({ onChanged }: { onChanged: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [encrypt, setEncrypt] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // When an encrypted import needs a passphrase, we remember the mode and show
  // an inline passphrase field + "Unlock import" button (instead of prompt()).
  const [pendingMode, setPendingMode] = useState<"merge" | "replace" | null>(
    null,
  );
  const [importPass, setImportPass] = useState("");

  // Delete-all confirmation via a typed field (instead of confirm()).
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  async function doExport() {
    if (encrypt && passphrase.length < 6) {
      setMsg("Enter a passphrase of at least 6 characters (or turn off encryption).");
      return;
    }
    setBusy(true);
    try {
      const res = await window.jobwell.exportData(encrypt ? passphrase : undefined);
      setMsg(
        res.saved
          ? `Exported ${res.encrypted ? "encrypted " : ""}backup${res.path ? ` to ${res.path}` : ""}.`
          : "Export cancelled.",
      );
    } catch (e) {
      setMsg(`Export failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // First import attempt (no passphrase). If the file is encrypted, reveal the
  // inline passphrase field and wait for the user to unlock it.
  async function startImport(mode: "merge" | "replace") {
    setBusy(true);
    setPendingMode(null);
    setImportPass("");
    try {
      const res = await window.jobwell.importData(mode);
      if (res && "needsPassphrase" in res) {
        setPendingMode(mode); // show the passphrase field
        setMsg("This backup is encrypted. Enter its passphrase below, then Unlock.");
        return;
      }
      reportImport(res);
    } catch (e) {
      setMsg(`Import failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Retry the import with the passphrase the user typed. The main process
  // re-opens the file dialog, so the user picks the same file again.
  async function unlockImport() {
    if (!pendingMode) return;
    if (!importPass) {
      setMsg("Enter the passphrase for this backup.");
      return;
    }
    setBusy(true);
    try {
      const res = await window.jobwell.importData(pendingMode, importPass);
      reportImport(res);
      if (res && !("needsPassphrase" in res)) {
        setPendingMode(null);
        setImportPass("");
      }
    } catch (e) {
      setMsg(`Import failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function reportImport(
    res:
      | import("@shared/types").ImportSummaryDTO
      | { needsPassphrase: true }
      | null,
  ) {
    if (!res) {
      setMsg("Import cancelled.");
    } else if ("needsPassphrase" in res) {
      setMsg("A passphrase is required for that file.");
    } else {
      setMsg(
        `Imported: ${res.jobsImported} jobs, ${res.applicationsImported} applications, ${res.savedSearchesImported} searches${res.profileImported ? ", profile" : ""}${res.resumeImported ? ", resume" : ""}.`,
      );
      onChanged();
    }
  }

  async function confirmDelete() {
    if (deleteConfirm !== "DELETE") {
      setMsg('Type DELETE (in capitals) to confirm.');
      return;
    }
    setBusy(true);
    try {
      await window.jobwell.deleteAllData();
      setMsg("All local data deleted.");
      setShowDelete(false);
      setDeleteConfirm("");
      onChanged();
    } catch (e) {
      setMsg(`Delete failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="job" style={{ display: "block", marginTop: 20 }}>
      <h3>Data &amp; backup</h3>
      <p className="hint">
        Export your data to move it to another computer without starting over.
        Encrypt it with a passphrase so it's safe to keep in a synced cloud
        folder (Dropbox, OneDrive) — only your passphrase can open it. Nothing
        is uploaded by the app itself.
      </p>

      <label className="row" style={{ gap: 8 }}>
        <input
          type="checkbox"
          checked={encrypt}
          onChange={(e) => setEncrypt(e.target.checked)}
        />
        Encrypt the backup (recommended)
      </label>

      {encrypt && (
        <label>
          Passphrase (for export)
          <input
            type="password"
            value={passphrase}
            placeholder="at least 6 characters — you'll need this to restore"
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
      )}

      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button className="primary" onClick={doExport} disabled={busy}>
          Export backup
        </button>
        <button
          className="tab"
          onClick={() => startImport("merge")}
          disabled={busy}
        >
          Import (merge)
        </button>
        <button
          className="tab"
          onClick={() => startImport("replace")}
          disabled={busy}
          title="Wipe current data, then load the backup"
        >
          Import (replace)
        </button>
        <span className="spacer" />
        <button
          className="tab danger"
          onClick={() => setShowDelete((s) => !s)}
          disabled={busy}
        >
          Delete all data…
        </button>
      </div>

      {/* Inline passphrase field shown only when an encrypted import needs one. */}
      {pendingMode && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input
            type="password"
            className="filter-input"
            placeholder="Backup passphrase"
            value={importPass}
            onChange={(e) => setImportPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void unlockImport();
            }}
          />
          <button className="primary" onClick={unlockImport} disabled={busy}>
            Unlock import
          </button>
          <button
            className="tab"
            onClick={() => {
              setPendingMode(null);
              setImportPass("");
              setMsg("Import cancelled.");
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Delete-all confirmation via typed field, not a browser dialog. */}
      {showDelete && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <span className="hint">
            Permanently deletes ALL local data and clears any stored AI key.
            Type DELETE to confirm:
          </span>
          <input
            className="filter-input"
            placeholder="DELETE"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
          />
          <button className="tab danger" onClick={confirmDelete} disabled={busy}>
            Confirm delete
          </button>
          <button
            className="tab"
            onClick={() => {
              setShowDelete(false);
              setDeleteConfirm("");
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <p className="hint" style={{ marginTop: 8 }}>
        Tip: to sync across devices, export an encrypted backup into a folder
        your cloud app syncs, then import it on the other device.
      </p>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}
