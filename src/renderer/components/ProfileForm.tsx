import { useState } from "react";
import type { JobLevel, Profile } from "@shared/types";

const LEVELS: JobLevel[] = [
  "intern",
  "entry",
  "mid",
  "senior",
  "staff",
  "lead",
];

export function ProfileForm({
  profile,
  onSaved,
}: {
  profile: Profile | null;
  onSaved: () => void;
}) {
  const [jobFunction, setJobFunction] = useState(
    profile?.jobFunction.join(", ") ?? "",
  );
  const [level, setLevel] = useState<JobLevel>(profile?.level ?? "mid");
  const [location, setLocation] = useState(profile?.location ?? "");
  const [skills, setSkills] = useState(profile?.skills.join(", ") ?? "");
  const [industries, setIndustries] = useState(
    profile?.industries.join(", ") ?? "",
  );
  const [years, setYears] = useState(profile?.yearsExperience ?? 3);
  const [baseCountry, setBaseCountry] = useState(profile?.baseCountry ?? "");
  const [workAuth, setWorkAuth] = useState(
    profile?.workAuthorizations.join(", ") ?? "",
  );
  const [facts, setFacts] = useState<string[]>(
    profile?.supplementaryFacts ?? [],
  );
  const [saving, setSaving] = useState(false);

  async function removeFact(fact: string) {
    const updated = await window.jobwell.removeSupplementaryFact(fact);
    setFacts(updated?.supplementaryFacts ?? []);
    onSaved();
  }

  function parseList(s: string): string[] {
    return s
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  }

  // Job functions keep their original casing (they're shown back to the user
  // and in match reasons); role matching lowercases internally anyway.
  function parseRoles(s: string): string[] {
    return s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function save() {
    setSaving(true);
    await window.jobwell.saveProfile({
      jobFunction: parseRoles(jobFunction),
      level,
      location,
      skills: parseList(skills),
      industries: parseList(industries),
      yearsExperience: Number(years),
      baseCountry: baseCountry.trim().toLowerCase(),
      workAuthorizations: parseList(workAuth),
      // Preserve saved facts — the form doesn't edit them, and overwriting the
      // profile must not silently drop them.
      supplementaryFacts: facts,
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="form">
      <h2>Your profile</h2>
      <p className="hint">
        Stored locally only. Match scores use these to rank jobs, and every
        score shows its reasons.
      </p>

      <label>
        Job function(s)
        <input
          value={jobFunction}
          placeholder="e.g. Software Engineer, Backend Engineer"
          onChange={(e) => setJobFunction(e.target.value)}
        />
      </label>
      <p className="hint">
        Comma-separate multiple target roles if you're open to several. Each job
        is scored against your best-matching role, so adding more never lowers a
        strong match.
      </p>

      <label>
        Level
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as JobLevel)}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <label>
        Location
        <input
          value={location}
          placeholder="e.g. Remote, or Seattle"
          onChange={(e) => setLocation(e.target.value)}
        />
      </label>

      <label>
        Skills (comma-separated)
        <input
          value={skills}
          placeholder="e.g. typescript, react, node, sql"
          onChange={(e) => setSkills(e.target.value)}
        />
      </label>

      <label>
        Industries (comma-separated)
        <input
          value={industries}
          placeholder="e.g. fintech, payments"
          onChange={(e) => setIndustries(e.target.value)}
        />
      </label>

      <label>
        Years of experience
        <input
          type="number"
          min={0}
          max={40}
          value={years}
          onChange={(e) => setYears(Number(e.target.value))}
        />
      </label>

      <label>
        Base country (where you live now)
        <input
          value={baseCountry}
          placeholder="e.g. nigeria"
          onChange={(e) => setBaseCountry(e.target.value)}
        />
      </label>
      <p className="hint">
        Eligibility is judged from here. Change it if you relocate and the whole
        feed re-evaluates — nothing to rebuild.
      </p>

      <label>
        Work authorizations (comma-separated, optional)
        <input
          value={workAuth}
          placeholder="countries/regions you can already work in, e.g. eu, uk"
          onChange={(e) => setWorkAuth(e.target.value)}
        />
      </label>

      <div className="saved-facts">
        <h3>Saved facts about you</h3>
        <p className="hint">
          True statements you saved while filling cover-letter gaps. The AI may
          use these, and they stop being flagged as gaps. Remove any that no
          longer apply.
        </p>
        {facts.length === 0 ? (
          <p className="hint">
            None yet. When a cover letter flags a gap, type the true fact and
            hit “Save to profile” to keep it here.
          </p>
        ) : (
          <ul className="fact-list">
            {facts.map((f) => (
              <li key={f}>
                <span>{f}</span>
                <button className="link-danger" onClick={() => removeFact(f)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        className="primary"
        onClick={save}
        disabled={saving || !jobFunction.trim()}
      >
        {saving ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}
