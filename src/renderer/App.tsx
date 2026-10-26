import { useEffect, useMemo, useState } from "react";
import type { JobFilter, JobWithMatch, Profile } from "@shared/types";
import { applyFilter, sortByEligibilityThenMatch } from "@shared/filtering";
import { dedupeJobs } from "@shared/dedup";
import { Feed } from "./components/Feed";
import { Tracker } from "./components/Tracker";
import { ProfileForm } from "./components/ProfileForm";
import { FilterBar } from "./components/FilterBar";
import { SavedSearches } from "./components/SavedSearches";
import { ResumePanel } from "./components/ResumePanel";
import { Network } from "./components/Network";
import { Analytics } from "./components/Analytics";
import { Settings } from "./components/Settings";
import { Sources } from "./components/Sources";
import { DataBackup } from "./components/DataBackup";

type Tab =
  | "feed"
  | "tracker"
  | "analytics"
  | "resume"
  | "network"
  | "sources"
  | "profile"
  | "settings";

export function App() {
  const [tab, setTab] = useState<Tab>("feed");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<JobWithMatch[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [filter, setFilter] = useState<JobFilter>({});
  const [savedKey, setSavedKey] = useState(0);
  const [fxDate, setFxDate] = useState<string | null>(null);
  const [showSaveSearch, setShowSaveSearch] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveAlert, setSaveAlert] = useState(true);

  async function load() {
    const [p, j, fx] = await Promise.all([
      window.jobwell.getProfile(),
      window.jobwell.listJobs(),
      window.jobwell.getFxStatus(),
    ]);
    setProfile(p);
    setJobs(j);
    setFxDate(fx?.date ?? null);
    if (!p) setTab("profile");
  }

  useEffect(() => {
    void load();
  }, []);

  async function refresh() {
    setRefreshing(true);
    setStatus("Fetching your sources…");
    try {
      const res = await window.jobwell.refreshJobs();
      setStatus(`Added ${res.added} new job(s). ${res.total} total.`);
      await load();
    } catch (err) {
      setStatus(`Refresh failed: ${String(err)}`);
    } finally {
      setRefreshing(false);
    }
  }

  const visible = useMemo(() => {
    // 1) filter, 2) collapse the same role seen on multiple boards into one
    // entry, 3) eligibility-first ordering then match % within each band.
    const filtered = applyFilter(jobs, filter);
    const deduped = dedupeJobs(filtered);
    return sortByEligibilityThenMatch(deduped);
  }, [jobs, filter]);

  // Inline save-search form (Electron has no window.prompt/confirm).
  function beginSaveSearch() {
    setSaveName("");
    setSaveAlert(true);
    setShowSaveSearch(true);
  }

  async function commitSaveSearch() {
    const name = saveName.trim();
    if (!name) return;
    await window.jobwell.createSavedSearch(name, filter, saveAlert);
    setShowSaveSearch(false);
    setSaveName("");
    setSavedKey((k) => k + 1);
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">JobWell</span>
        <div className="tabs">
          <button
            className={`tab ${tab === "feed" ? "active" : ""}`}
            onClick={() => setTab("feed")}
          >
            Feed
          </button>
          <button
            className={`tab ${tab === "tracker" ? "active" : ""}`}
            onClick={() => setTab("tracker")}
          >
            Tracker
          </button>
          <button
            className={`tab ${tab === "analytics" ? "active" : ""}`}
            onClick={() => setTab("analytics")}
          >
            Analytics
          </button>
          <button
            className={`tab ${tab === "resume" ? "active" : ""}`}
            onClick={() => setTab("resume")}
          >
            Resume
          </button>
          <button
            className={`tab ${tab === "network" ? "active" : ""}`}
            onClick={() => setTab("network")}
          >
            Network
          </button>
          <button
            className={`tab ${tab === "sources" ? "active" : ""}`}
            onClick={() => setTab("sources")}
          >
            Sources
          </button>
          <button
            className={`tab ${tab === "profile" ? "active" : ""}`}
            onClick={() => setTab("profile")}
          >
            Profile
          </button>
          <button
            className={`tab ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            Settings
          </button>
        </div>
        <div className="spacer" />
        <span className="hint">{status}</span>
        <button className="primary" onClick={refresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh jobs"}
        </button>
      </div>

      <div className="content">
        {tab === "feed" && (
          <>
            <FilterBar
              filter={filter}
              onChange={setFilter}
              onSave={beginSaveSearch}
            />
            {showSaveSearch && (
              <div className="row" style={{ gap: 8, margin: "0 0 12px" }}>
                <input
                  className="filter-input"
                  placeholder="Name this search"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitSaveSearch();
                  }}
                  autoFocus
                />
                <label className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={saveAlert}
                    onChange={(e) => setSaveAlert(e.target.checked)}
                  />
                  Alert on new matches
                </label>
                <button
                  className="primary"
                  onClick={commitSaveSearch}
                  disabled={!saveName.trim()}
                >
                  Save
                </button>
                <button className="tab" onClick={() => setShowSaveSearch(false)}>
                  Cancel
                </button>
              </div>
            )}
            {fxDate && (
              <p className="hint" style={{ margin: "0 0 10px" }}>
                Pay in other currencies is converted to USD using live rates
                (as of {fxDate}). Figures marked ≈ are approximate.
              </p>
            )}
            <SavedSearches onApply={setFilter} refreshKey={savedKey} />
            <Feed jobs={visible} hasProfile={!!profile} onReload={load} />
          </>
        )}
        {tab === "tracker" && <Tracker jobs={jobs} onReload={load} />}
        {tab === "analytics" && <Analytics jobs={jobs} />}
        {tab === "resume" && <ResumePanel />}
        {tab === "network" && <Network />}
        {tab === "sources" && <Sources onChanged={() => setStatus("Sources updated. Refresh jobs to apply.")} />}
        {tab === "profile" && (
          <ProfileForm
            profile={profile}
            onSaved={async () => {
              await load();
              setTab("feed");
            }}
          />
        )}
        {tab === "settings" && (
          <>
            <Settings />
            <DataBackup onChanged={load} />
          </>
        )}
      </div>
    </div>
  );
}
