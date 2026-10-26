import { useEffect, useState } from "react";
import type { JobFilter, SavedSearchWithCount } from "@shared/types";

export function SavedSearches({
  onApply,
  refreshKey,
}: {
  onApply: (filter: JobFilter) => void;
  refreshKey: number;
}) {
  const [searches, setSearches] = useState<SavedSearchWithCount[]>([]);

  async function load() {
    setSearches(await window.jobwell.listSavedSearches());
  }

  useEffect(() => {
    void load();
  }, [refreshKey]);

  if (searches.length === 0) return null;

  return (
    <div className="saved">
      <h3 className="saved-title">Saved searches</h3>
      {searches.map((s) => (
        <div className="saved-item" key={s.id}>
          <button className="saved-apply" onClick={() => onApply(s.filter)}>
            {s.name}
          </button>
          <span className="badge">{s.matchCount} match</span>
          {s.alert && s.newCount > 0 && (
            <span className="badge alert">{s.newCount} new</span>
          )}
          <span className="spacer" />
          {s.newCount > 0 && (
            <button
              className="tab"
              onClick={async () => {
                await window.jobwell.markSavedSearchSeen(s.id);
                void load();
              }}
            >
              Mark seen
            </button>
          )}
          <button
            className="tab danger"
            onClick={async () => {
              await window.jobwell.deleteSavedSearch(s.id);
              void load();
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
