"use client";

import { Check, LoaderCircle, MapPin, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { CampusRecord } from "@/lib/indian-campuses";

export function CampusPicker({ value, onChange, label = "Campus", placeholder = "Search Indian colleges and universities", required = false, allowCustom = false }: { value: string; onChange: (value: string) => void; label?: string; placeholder?: string; required?: boolean; allowCustom?: boolean }) {
  const safeValue = value || "";
  const listId = useId();
  const [query, setQuery] = useState(safeValue);
  const [results, setResults] = useState<CampusRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(Boolean(safeValue));
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2 || selected) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearchError("");
      try {
        const response = await fetch(`/api/campuses?q=${encodeURIComponent(normalized)}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { data?: { campuses?: CampusRecord[] }; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not search the campus directory.");
        if (!controller.signal.aborted) {
          const campuses = result.data?.campuses || [];
          setResults(campuses);
          setActiveIndex(campuses.length ? 0 : -1);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setResults([]);
          setActiveIndex(-1);
          setSearchError(error instanceof Error ? error.message : "Could not search the campus directory.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selected]);

  function typeCampus(next: string) {
    setQuery(next);
    onChange(next);
    setSelected(false);
    setOpen(true);
    setActiveIndex(-1);
    setSearchError("");
    if (next.trim().length < 2) { setResults([]); setLoading(false); }
  }

  function selectCampus(campus: CampusRecord) {
    setQuery(campus.name);
    onChange(campus.name);
    setSelected(true);
    setLoading(false);
    setResults([]);
    setActiveIndex(-1);
    setSearchError("");
    setOpen(false);
  }

  function useCustomCampus() {
    const custom = query.trim();
    if (custom.length < 2) return;
    onChange(custom);
    setSelected(true);
    setLoading(false);
    setResults([]);
    setActiveIndex(-1);
    setSearchError("");
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!results.length) return;
      setActiveIndex((current) => {
        if (event.key === "ArrowDown") return current < results.length - 1 ? current + 1 : 0;
        return current > 0 ? current - 1 : results.length - 1;
      });
      return;
    }
    if (event.key === "Home" && open && results.length) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && open && results.length) {
      event.preventDefault();
      setActiveIndex(results.length - 1);
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault();
      selectCampus(results[activeIndex]);
    }
  }

  const expanded = open && query.trim().length >= 2 && !selected;
  const activeOptionId = expanded && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;

  return <label className="field campus-picker"><span>{label}</span><div className="campus-combobox"><Search size={17} /><input required={required} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded} aria-controls={listId} aria-activedescendant={activeOptionId} autoComplete="off" value={query} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => { setOpen(false); setActiveIndex(-1); }, 140)} onKeyDown={handleKeyDown} onChange={(event) => typeCampus(event.target.value)} placeholder={placeholder} maxLength={180} />{selected ? <Check className="campus-selected-icon" size={16} aria-label="Campus selected" /> : loading ? <LoaderCircle className="spin" size={16} aria-label="Searching campuses" /> : null}</div>{expanded && <div className="campus-results" id={listId} role="listbox" aria-label="Matching campuses">{results.map((campus, index) => <button className={activeIndex === index ? "active" : ""} id={`${listId}-option-${index}`} type="button" role="option" aria-selected={activeIndex === index} tabIndex={-1} key={campus.id} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCampus(campus)}><MapPin size={16} /><span><b>{campus.name}</b><small>{[campus.city, campus.state, campus.type].filter(Boolean).join(" · ")}</small></span></button>)}{loading && !results.length && <div className="campus-result-status" role="status"><LoaderCircle className="spin" size={17} /> Searching India’s campus directory…</div>}{searchError && <div className="campus-result-status error" role="alert">{searchError}</div>}{!loading && !searchError && !results.length && (allowCustom
  ? <button type="button" className="campus-use-custom" onMouseDown={(event) => event.preventDefault()} onClick={useCustomCampus}><MapPin size={16} /> <span>Use “<b>{query.trim()}</b>” as your campus</span></button>
  : <div className="campus-result-status">No matching campus in the current directory.</div>)}</div>}<small className={searchError ? "campus-hint invalid" : "campus-hint"}>{searchError || (allowCustom ? "Pick from the Indian campus directory, or type your campus name and choose “Use …” if it isn’t listed." : "Select a result from the Indian campus directory. Use ↑ and ↓ to browse, then Enter to select.")}</small></label>;
}
