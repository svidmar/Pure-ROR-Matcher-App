import { useEffect, useRef, useState } from "react";
import { PURE_BASE_URL, PURE_API_KEY, ROR_TYPE } from "./config";


/*************************
 * TYPES
 *************************/
type LocaleMap = { [k: string]: string };

type Term = {
  en_GB?: string;
  da_DK?: string;
  [k: string]: string | undefined;
};

type IdentifierType = {
  uri: string;
  term: Term;
};

type ClassifiedId = {
  typeDiscriminator: "ClassifiedId";
  id: string; // e.g., "https://ror.org/..."
  type: IdentifierType;
};

type Identifier = ClassifiedId | any;

type Country = {
  uri?: string;
  term?: Term;
};

type Address = {
  city?: string;
  country?: Country;
};

type ExtOrgItem = {
  uuid: string;
  version: string;
  name?: LocaleMap;
  type?: { uri: string; term?: Term };
  identifiers?: Identifier[];
  address?: Address;
  workflow?: { step?: string; description?: Term };
};

type PageResponse = {
  count: number;
  items: ExtOrgItem[];
};

interface RorOrg {
  id: string;
  name?: string;
  names?: { value: string; types?: string[]; lang?: string }[];
  country?: { country_code?: string; country_name?: string };
  aliases?: string[];
  acronyms?: string[];
  links?: string[];
  types?: string[];
  score?: number;
  locations?: {
    geonames_details?: {
      country_name?: string;
      country_code?: string;
      continent_name?: string;
      country_subdivision_name?: string;
      name?: string;
    };
    geonames_id?: number;
  }[];
}

type Toast = { type: "success" | "error"; message: string } | null;

type HistoryEntry = {
  ts: number;
  uuid: string;
  orgName: string;
  rorId: string;
  score: number;
  matchType?: string;
};

/*************************
 * HELPERS
 *************************/
function buildUrl(base: string, path: string) {
  const b = (base || "").replace(/\/+$/, "");
  const p = (path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function useLimitedFetch(rateLimitMs: number) {
  const lastCall = useRef(0);
  return async (input: RequestInfo, init?: RequestInit) => {
    const now = Date.now();
    const delta = now - lastCall.current;
    if (delta < rateLimitMs) await sleep(rateLimitMs - delta);
    lastCall.current = Date.now();
    const headers = {
      Accept: "application/json",
      "api-key": PURE_API_KEY,
      ...(init?.headers || {}),
    } as HeadersInit;
    return fetch(input, { ...(init || {}), headers });
  };
}

function pickPreferredLocale(map?: LocaleMap, preferred: string[] = ["en_GB", "da_DK"]) {
  if (!map) return { value: "", key: "" };
  for (const key of preferred) {
    if (map[key]) return { value: map[key]!, key };
  }
  const firstKey = Object.keys(map)[0];
  return { value: firstKey ? map[firstKey]! : "", key: firstKey ?? "" };
}

function hasRorIdentifier(identifiers?: Identifier[]): boolean {
  if (!identifiers) return false;
  return identifiers.some(
    (id: any) =>
      id?.typeDiscriminator === "ClassifiedId" &&
      typeof id?.type?.uri === "string" &&
      id.type.uri.endsWith("/ror")
  );
}

/** Prefer 'ror_display', then 'label', then first name value, else id */
function rorDisplayName(r: RorOrg): string {
  if (r.name && r.name.trim()) return r.name;
  const pick =
    r.names?.find((n) => n.types?.includes("ror_display")) ||
    r.names?.find((n) => n.types?.includes("label")) ||
    r.names?.[0];
  return pick?.value || r.id;
}

/** Merge aliases from `names[types~="alias"]` and `aliases` field, dedupe, drop the display name */
function rorAliasList(r: RorOrg): string[] {
  const fromNames =
    (r.names || [])
      .filter((n) => n.types?.includes("alias"))
      .map((n) => n.value)
      .filter(Boolean) || [];
  const fromAliasesField = r.aliases || [];
  const display = rorDisplayName(r).toLowerCase();
  const merged = Array.from(new Set([...fromAliasesField, ...fromNames]));
  return merged.filter((a) => a && a.toLowerCase() !== display);
}

/** Safely format a score */
function fmtScore(val: unknown, digits = 3): string {
  const n = Number(val);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}



/*************************
 * MAIN APP
 *************************/
export default function App() {
  const limitedFetch = useLimitedFetch(350);

  // gamification points
  
  const [points, setPoints] = useState<number>(() => parseInt(localStorage.getItem("ror_match_points") || "0", 10));
  useEffect(() => localStorage.setItem("ror_match_points", String(points)), [points]);

  // link history
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("ror_match_history") || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem("ror_match_history", JSON.stringify(history));
  }, [history]);

  // state
  const [org, setOrg] = useState<ExtOrgItem | null>(null);
  const [candidates, setCandidates] = useState<
    (RorOrg & { scoreLocal: number; matching_type?: string; chosen?: boolean; substring?: string })[]
  >([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // confirmation modal
  const [confirmOpen, setConfirmOpen] = useState(false);

  // auto-hide toast after 3s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /************* Pure helpers *************/
  const getCount = async (): Promise<number> => {
    const url = buildUrl(PURE_BASE_URL, "/external-organizations?size=1&offset=0");
    const res = await limitedFetch(url);
    if (!res.ok) throw new Error(`Failed to fetch count: ${res.status} ${res.statusText}`);
    const data: PageResponse = await res.json();
    return data.count || 0;
  };

  const fetchRandomOrg = async (): Promise<ExtOrgItem | null> => {
  const count = await getCount();
  if (!count) return null;
  const offset = Math.floor(Math.random() * count);
  const url = buildUrl(PURE_BASE_URL, `/external-organizations?size=1&offset=${offset}`);
  const res = await limitedFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch org: ${res.status}`);
  const data: PageResponse = await res.json();
  const item = data.items[0];

  // Only return orgs that don’t already have a ROR and are either forApproval OR approved
  if (
    (item?.workflow?.step === "forApproval" || item?.workflow?.step === "approved") &&
    !hasRorIdentifier(item.identifiers)
  ) {
    return item;
  }
  return null;
};

  const fetchOrg = async (uuid: string): Promise<ExtOrgItem> => {
    const url = buildUrl(PURE_BASE_URL, `/external-organizations/${uuid}`);
    const res = await limitedFetch(url);
    if (!res.ok) throw new Error(`Failed to fetch organization: ${res.status}`);
    return res.json();
  };

  const putOrg = async (payload: { uuid: string; version: string; identifiers: Identifier[] }) => {
    const url = buildUrl(PURE_BASE_URL, `/external-organizations/${payload.uuid}`);

    // only send version + identifiers, not uuid
    const bodyToSend = {
      version: payload.version,
      identifiers: payload.identifiers,
    };

    const res = await limitedFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyToSend),
    });

    let responseBody: any = null;
    try {
      responseBody = await res.json();
    } catch {
      responseBody = { status: res.status };
    }

    if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
    return responseBody; // often the updated object
  };

  /************* ROR affiliation search (name only) *************/
  const searchRor = async (
    o: ExtOrgItem
  ): Promise<(RorOrg & { scoreLocal: number; matching_type?: string; chosen?: boolean; substring?: string })[]> => {
    const nameOnly = (pickPreferredLocale(o.name).value || "").trim();
    if (!nameOnly) return [];

    const url = `https://api.ror.org/organizations?affiliation=${encodeURIComponent(nameOnly)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`ROR affiliation search failed: ${res.status}`);

    const data: any = await res.json();
    const raw = Array.isArray(data?.items) ? data.items : [];

    const items = raw.map((it: any) => {
      const r: RorOrg = it?.organization || ({} as RorOrg);
      const sc = Number(it?.score);
      const scoreLocal = Number.isFinite(sc) ? sc : 0;
      return {
        ...r,
        scoreLocal,
        matching_type: typeof it?.matching_type === "string" ? it.matching_type : undefined,
        chosen: !!it?.chosen,
        substring: typeof it?.substring === "string" ? it.substring : undefined,
      };
    });

    // chosen first, then by score
    items.sort((a: any, b: any) => Number(!!b.chosen) - Number(!!a.chosen) || b.scoreLocal - a.scoreLocal);
    
    // Fetch full location details for each candidate
    const itemsWithLocations = await Promise.all(
      items.slice(0, 10).map(async (item) => {
        try {
          const rorId = item.id.replace('https://ror.org/', '');
          const detailUrl = `https://api.ror.org/v2/organizations/${rorId}`;
          const detailRes = await fetch(detailUrl, { headers: { Accept: "application/json" } });
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            return { ...item, locations: detailData.locations };
          }
        } catch (e) {
          console.warn(`Failed to fetch location for ${item.id}:`, e);
        }
        return item;
      })
    );
    
    // Preselect best if strong
    if ((itemsWithLocations[0]?.scoreLocal ?? 0) >= 0.7) setSelectedIdx(0);
    return itemsWithLocations;
  };

  /************* actions *************/
  const loadNext = async () => {
    setError(null);
    setLoading(true);
    setCandidates([]);
    setSelectedIdx(null);
    setOrg(null);
    try {
      const candidate = await fetchRandomOrg();
      if (!candidate) throw new Error("No eligible external organizations found right now.");
      setOrg(candidate);
      const rorList = await searchRor(candidate);
      setCandidates(rorList);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const doLink = async () => {
    if (!org || selectedIdx === null || selectedIdx < 0) return;
    const chosen = candidates[selectedIdx];
    try {
      setLoading(true);
      setError(null);

      // Re-fetch to get latest version and identifiers RIGHT BEFORE PUT
      const latest = await fetchOrg(org.uuid);
      if (hasRorIdentifier(latest.identifiers)) {
        setToast({ type: "success", message: "Already linked: ROR ID is present." });
        setConfirmOpen(false);
        await loadNext();
        return;
      }

      const newIdentifiers: Identifier[] = [
        ...(latest.identifiers || []),
        { typeDiscriminator: "ClassifiedId", id: chosen.id, type: ROR_TYPE } as ClassifiedId,
      ];

      await putOrg({ uuid: latest.uuid, version: latest.version, identifiers: newIdentifiers });

      // points
      const sl = Number(chosen.scoreLocal) || 0;
      const award = sl >= 0.8 ? 10 : sl >= 0.6 ? 5 : 1;
      setPoints((p) => p + award);

      // add to history (cap to last 50)
      const orgName = pickPreferredLocale(latest.name).value || "External organization";
      setHistory((h) => {
        const next: HistoryEntry[] = [
          {
            ts: Date.now(),
            uuid: latest.uuid,
            orgName,
            rorId: chosen.id,
            score: sl,
            matchType: chosen.matching_type,
          },
          ...h,
        ];
        return next.slice(0, 50);
      });

      // success toast
      setToast({ type: "success", message: `Linked ROR to “${pickPreferredLocale(latest.name).value || "Org"}”.` });

      setConfirmOpen(false);
      await loadNext();
    } catch (e: any) {
      setError(e.message || String(e));
      setToast({ type: "error", message: `Failed to write to Pure: ${e?.message || e}` });
    } finally {
      setLoading(false);
    }
  };

  const openConfirm = () => {
    if (!org || selectedIdx === null || selectedIdx < 0) return;
    setConfirmOpen(true);
  };

  useEffect(() => {
    loadNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /************* UI helpers *************/
  const levelStops = [
    { label: "Unstructured Newbie 👶", threshold: 0 },
    { label: "Metadata Apprentice 🧙‍♀️", threshold: 250 },
    { label: "Pure Data influencer 🧑‍💻", threshold: 500 },
    { label: "Persistent Identifier Pro 😎", threshold: 700 },
    { label: "Final Boss of Metadata 👹", threshold: 900 },
  ];
  
  const maxPoints = 1000;
  const pct = Math.min(100, Math.round((points / maxPoints) * 100));
  const currentLevel =
    [...levelStops].reverse().find((s) => points >= s.threshold)?.label || levelStops[0].label;

  const matchTypeColor = (mt?: string) => {
    switch ((mt || "").toUpperCase()) {
      case "EXACT":
        return "border-emerald-500/60 bg-emerald-500/10";
      case "PHRASE":
        return "border-blue-500/60 bg-blue-500/10";
      case "COMMON TERMS":
        return "border-amber-500/60 bg-amber-500/10";
      case "FUZZY":
        return "border-fuchsia-500/60 bg-fuchsia-500/10";
      case "HEURISTICS":
        return "border-teal-500/60 bg-teal-500/10";
      case "ACRONYM":
        return "border-cyan-500/60 bg-cyan-500/10";
      default:
        return "border-white/15 bg-white/5";
    }
  };

  /************* UI *************/
  return (
    <div className="min-h-screen text-white bg-[#0b1020]">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50">
          <div
            className={`px-4 py-3 rounded-lg shadow-lg border ${
              toast.type === "success"
                ? "bg-emerald-600/90 border-emerald-400/70"
                : "bg-red-600/90 border-red-400/70"
            }`}
          >
            <div className="text-sm">{toast.message}</div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmOpen && org && selectedIdx !== null && candidates[selectedIdx] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmOpen(false)} />
          <div className="relative w-[min(640px,92vw)] rounded-2xl border border-white/15 bg-[#0f1530] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Confirm link to Pure</h3>
              <button
                className="text-white/70 hover:text-white text-xl"
                onClick={() => setConfirmOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="opacity-70">Organization:</span>{" "}
                <b>{pickPreferredLocale(org.name).value || "External organization"}</b>
              </div>
              <div className="text-xs opacity-80">
                UUID: <code>{org.uuid}</code>
              </div>
              <hr className="border-white/10 my-2" />
              <div>
                <span className="opacity-70">Selected ROR:</span>{" "}
                <a
                  href={candidates[selectedIdx].id}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:opacity-90"
                >
                  {candidates[selectedIdx].id}
                </a>
              </div>
              <div className="text-xs opacity-80">
                Match: {candidates[selectedIdx].matching_type || "—"} · Score:{" "}
                {fmtScore(candidates[selectedIdx].scoreLocal)}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded border border-white/15 bg-white/10 hover:bg-white/20"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded bg-green-600/80 hover:bg-green-600 border border-white/10"
                onClick={doLink}
                disabled={loading}
              >
                {loading ? "Linking…" : "Confirm & link"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4 space-y-6">
        {/* Full-width level meter (breaks out of max-width) */}
<div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen px-4 md:px-8">
  <div className="max-w-7xl mx-auto">
    <div className="flex items-center justify-between text-xs mb-2">
      <span className="opacity-80">
        Level: <b>{currentLevel}</b>
      </span>
      <span className="opacity-80">{points} pts</span>
    </div>

    <div className="relative h-7 rounded-xl bg-white/10 overflow-hidden border border-white/10">
      {/* filled track */}
      <div className="absolute left-0 top-0 bottom-0" style={{ width: `${pct}%` }}>
        <div className="h-full bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-emerald-400 opacity-90" />
      </div>
      {/* pointer */}
      <div
        className="absolute -top-1 w-0 h-0 border-l-8 border-r-8 border-b-[10px] border-transparent border-b-white/80"
        style={{ left: `calc(${pct}% - 8px)` }}
        title={`${points} pts`}
      />
      {/* ticks */}
      {levelStops.map((s, idx) => (
        <div
          key={idx}
          className="absolute top-0 bottom-0 border-l border-white/30"
          style={{ left: `${Math.min(100, (s.threshold / maxPoints) * 100)}%` }}
        />
      ))}
    </div>

    {/* Labels UNDER the bar, aligned to thresholds — single row */}
<div className="relative mt-3" style={{ height: "1.9rem" }}>
  {levelStops.map((s, i) => {
    const leftPct = Math.max(0, Math.min(100, (s.threshold / maxPoints) * 100));
    const unlocked = points >= s.threshold;

    // keep labels from clipping off the edges
    const shift =
      leftPct < 6 ? "translateX(0%)" : leftPct > 94 ? "translateX(-100%)" : "translateX(-50%)";

    return (
      <div
        key={s.label}
        className={`absolute top-0 text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap
          ${unlocked ? "bg-emerald-400/15 border-emerald-300/40" : "bg-white/10 border-white/20"}`}
        style={{ left: `${leftPct}%`, transform: shift }}
        title={`${s.label} (${s.threshold} pts)`}
      >
        <span className="opacity-80 mr-1">L{i + 1}</span>
        {s.label} <span className="opacity-70">({s.threshold})</span>
      </div>
    );
  })}
</div>
  </div>
</div>
        {/* Header */}
        <header className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#111736] to-[#0b1020] p-6 text-center md:text-left">
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
    {/* Icon */}
    <div className="flex items-center gap-3">
      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-emerald-500 border border-white/20 flex items-center justify-center text-2xl">
        🔗
      </div>
      <div>
        {/* Big Title */}
        <h1 className="text-3xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-emerald-400 bg-clip-text text-transparent">
            Pure External Organizations
          </span>{" "}
          →{" "}
          <span className="bg-gradient-to-r from-emerald-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
            ROR Matcher
          </span>
        </h1>
        {/* Subtitle */}
        <div className="text-sm opacity-70 mt-1">
          Link external organizations in Pure to ROR IDs.
        </div>
      </div>
    </div>

    {/* Stats (right side) */}
    <div className="flex flex-col items-start md:items-end text-sm opacity-70">
      <div>🔍 Candidates shown: {candidates.length}</div>
      <div>📜 History: {history.length} links</div>
    </div>
  </div>
        </header>

        {error && <div className="bg-red-500/20 border border-red-500/30 p-2 rounded">{error}</div>}

        <div className="flex gap-4 flex-wrap items-center">
          <button
            onClick={loadNext}
            disabled={loading}
            className="px-3 py-2 rounded bg-white/10 hover:bg-white/20 border border-white/10"
          >
            {loading ? "Loading…" : "Next random org"}
          </button>
          <button
            onClick={openConfirm}
            disabled={loading || selectedIdx === null}
            className="px-3 py-2 rounded bg-green-600/80 hover:bg-green-600 border border-white/10"
          >
            Link selected ROR
          </button>
        </div>

        {org && (
          <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">External organization</h2>
              {org.workflow?.step === "forApproval" && (
                <span className="text-xs px-2 py-1 rounded-full bg-yellow-600/30 border border-yellow-500/30">
                  For approval
                </span>
              )}
              {org.workflow?.step === "approved" && (
      <span className="text-xs px-2 py-1 rounded-full bg-green-600/30 border border-green-500/30">
        Approved
      </span>
    )}
            </div>
            <div className="mt-2 text-sm space-y-1">
              <div>
                <span className="opacity-70">Name:</span>{" "}
                <b>{pickPreferredLocale(org.name).value || "(no name)"}</b>
              </div>
              <div>
                <span className="opacity-70">UUID:</span>{" "}
                <code className="text-xs">{org.uuid}</code>
              </div>
              <div className="flex flex-wrap gap-4">
                {org.address?.country?.term?.en_GB && (
                  <div>
                    <span className="opacity-70">Pure country:</span>{" "}
                    <span>{org.address.country.term.en_GB}</span>
                  </div>
                )}
              </div>
              <div className="mt-2">
                <span className="opacity-70">Identifiers:</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(org.identifiers || []).map((id: any, idx) => (
                    <span
                      key={idx}
                      className={`text-xs px-2 py-1 rounded-full border ${
                        id?.typeDiscriminator === "ClassifiedId" && id?.type?.uri?.endsWith("/ror")
                          ? "bg-green-600/20 border-green-500/40"
                          : "bg-white/10 border-white/10"
                      }`}
                    >
                      {id?.type?.term?.en_GB || id?.typeDiscriminator || "id"}:{" "}
                      {id?.id || id?.value || "(n/a)"}
                    </span>
                  ))}
                  {(!org.identifiers || org.identifiers.length === 0) && (
                    <span className="text-xs opacity-70">None</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">ROR candidates</h2>
            <div className="text-xs opacity-70">{candidates.length} shown</div>
          </div>
          <div className="mt-2 space-y-2">
            {candidates.map((c, i) => {
              const chosen = !!c.chosen;
              const accent = matchTypeColor(c.matching_type);
              const country = c.country?.country_name || c.country?.country_code || "";
              const aliases = rorAliasList(c);
              return (
                <div
                  key={c.id + i}
                  className={`p-3 rounded-xl border ${accent} ${
                    chosen ? "ring-2 ring-offset-2 ring-green-400/70 ring-offset-[#0b1020]" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">
                      <b>{rorDisplayName(c)}</b>
                      {aliases.length ? (
                        <span className="opacity-70"> (aliases: {aliases.join(", ")})</span>
                      ) : null}
                    </div>
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name="ror"
                        checked={selectedIdx === i}
                        onChange={() => setSelectedIdx(i)}
                      />{" "}
                      Select
                    </label>
                  </div>
                  
                  {/* Location comparison */}
                  <div className="mt-2 flex flex-wrap gap-4 text-xs">
                    {org?.address?.country?.term?.en_GB && (
                      <div className="px-2 py-1 rounded bg-blue-500/15 border border-blue-400/30">
                        <span className="opacity-70">Pure country:</span>{" "}
                        <span className="font-medium">{org.address.country.term.en_GB}</span>
                      </div>
                    )}
                    {c.locations?.[0]?.geonames_details?.country_name && (
                      <div className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-400/30">
                        <span className="opacity-70">ROR location:</span>{" "}
                        <span className="font-medium">{c.locations[0].geonames_details.country_name}</span>
                        {c.locations[0].geonames_details.country_subdivision_name && (
                          <span className="opacity-70">, {c.locations[0].geonames_details.country_subdivision_name}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-1 text-xs opacity-80 space-x-3">
                    {typeof c.matching_type === "string" && (
                      <span className="inline-flex items-center gap-1">
                        <span className="opacity-70">Match:</span> {c.matching_type}
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 ${chosen ? "text-green-300 font-medium" : ""}`}>
                      <span className="opacity-70">Chosen:</span> {String(chosen)}
                    </span>
                  </div>

                  <div className="mt-1 text-xs opacity-80">
                    ROR id:{" "}
                    <a
                      href={c.id}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:opacity-90"
                    >
                      {c.id}
                    </a>{" "}
                    · score: {fmtScore(c.scoreLocal)}
                  </div>
                </div>
              );
            })}
            {candidates.length === 0 && <div className="text-sm opacity-70">No suggestions yet.</div>}
          </div>
        </div>

        {/* History Panel */}
        <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Link history</h2>
            <button
              className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/10"
              onClick={() => {
                if (window.confirm("Clear link history?")) setHistory([]);
              }}
            >
              Clear
            </button>
          </div>
          {history.length === 0 ? (
            <div className="mt-2 text-sm opacity-70">No links yet.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {history.slice(0, 20).map((h) => (
                <div
                  key={`${h.ts}-${h.uuid}-${h.rorId}`}
                  className="p-3 rounded-xl border border-white/10 bg-white/5 text-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <div className="font-medium">{h.orgName}</div>
                      <div className="text-xs opacity-80">
                        UUID: <code>{h.uuid}</code>
                      </div>
                    </div>
                    <div className="text-xs">
                      ROR:{" "}
                      <a
                        href={h.rorId}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:opacity-90"
                      >
                        {h.rorId}
                      </a>
                      <div className="opacity-70">
                        Score: {fmtScore(h.score)}
                        {h.matchType ? ` · Match: ${h.matchType}` : ""}
                      </div>
                      <div className="opacity-70">{new Date(h.ts).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              ))}
              {history.length > 20 && (
                <div className="text-xs opacity-60">Showing last 20 of {history.length} entries.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}