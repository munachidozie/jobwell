import type { BoardProvider, JobFilter, WorkModel } from "@shared/types";

const WORK_MODELS: WorkModel[] = ["onsite", "hybrid", "remote"];
const PROVIDERS: BoardProvider[] = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "recruitee",
];

export function FilterBar({
  filter,
  onChange,
  onSave,
}: {
  filter: JobFilter;
  onChange: (f: JobFilter) => void;
  onSave: () => void;
}) {
  function toggle<T>(list: T[] | undefined, value: T): T[] {
    const set = new Set(list ?? []);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return [...set];
  }

  return (
    <div className="filterbar">
      <input
        className="filter-input"
        placeholder='Search e.g. react typescript, "c#", ".net"'
        value={filter.text ?? ""}
        onChange={(e) => onChange({ ...filter, text: e.target.value })}
      />
      <input
        className="filter-input"
        placeholder="Location"
        value={filter.location ?? ""}
        onChange={(e) => onChange({ ...filter, location: e.target.value })}
      />

      <div className="chips">
        {WORK_MODELS.map((m) => (
          <button
            key={m}
            className={`chip ${filter.workModels?.includes(m) ? "on" : ""}`}
            onClick={() =>
              onChange({ ...filter, workModels: toggle(filter.workModels, m) })
            }
          >
            {m}
          </button>
        ))}
      </div>

      <div className="chips">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            className={`chip ${filter.providers?.includes(p) ? "on" : ""}`}
            onClick={() =>
              onChange({ ...filter, providers: toggle(filter.providers, p) })
            }
          >
            {p}
          </button>
        ))}
      </div>

      <label className="filter-range">
        Min match: {filter.minMatchPercent ?? 0}%
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={filter.minMatchPercent ?? 0}
          onChange={(e) =>
            onChange({ ...filter, minMatchPercent: Number(e.target.value) })
          }
        />
      </label>

      <label className="filter-range">
        Posted within
        <select
          className="status-select"
          value={filter.postedWithinDays ?? 0}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange({
              ...filter,
              postedWithinDays: v === 0 ? undefined : v,
            });
          }}
        >
          <option value={0}>any time</option>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </label>

      <label className="filter-range">
        Min pay (USD/yr)
        <select
          className="status-select"
          value={filter.minAnnualUsd ?? 0}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange({ ...filter, minAnnualUsd: v === 0 ? undefined : v });
          }}
        >
          <option value={0}>any</option>
          <option value={30000}>$30k+</option>
          <option value={50000}>$50k+</option>
          <option value={80000}>$80k+</option>
          <option value={120000}>$120k+</option>
        </select>
      </label>

      <button
        className={`chip ${filter.onlyEligible ? "on" : ""}`}
        onClick={() =>
          onChange({ ...filter, onlyEligible: !filter.onlyEligible })
        }
        title="Show only roles you can actually take (remote-eligible or sponsorship)"
      >
        ✅ Only roles I can take
      </button>

      <button
        className={`chip ${filter.onlySponsorship ? "on" : ""}`}
        onClick={() =>
          onChange({ ...filter, onlySponsorship: !filter.onlySponsorship })
        }
        title="Show only roles that explicitly offer visa/relocation sponsorship"
      >
        🛂 Sponsorship only
      </button>

      <button className="primary" onClick={onSave}>
        Save search
      </button>
    </div>
  );
}
