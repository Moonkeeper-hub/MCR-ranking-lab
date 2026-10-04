import type { PlayerInput, ResultInput } from "../engine/types";

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'; i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  if (!rows.length) return [];

  const headers = rows[0].map((x) => x.trim());
  return rows.slice(1).filter((r) => r.some((x) => x !== "")).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))
  );
}

function asBool(value: string | undefined): boolean {
  return ["true", "1", "yes", "y", "да"].includes(String(value ?? "").trim().toLowerCase());
}

export function playersFromCsv(text: string): PlayerInput[] {
  const rows = parseCsv(text);
  const required = ["player_id", "player_name"];
  for (const key of required) if (rows.length && !(key in rows[0])) throw new Error(`players.csv: нет колонки ${key}`);
  return rows.map((r) => ({
    ...r,
    player_id: String(r.player_id),
    player_name: String(r.player_name),
    initial_eu: Number(r.initial_eu || r.current_eu || 0),
    initial_marks: Number(r.initial_marks || 0),
    initial_dan_date: r.initial_dan_date || r.last_norm_date || "",
    include_in_rating: ("include_in_rating" in r)
      ? asBool(r.include_in_rating)
      : (("display_in_rating" in r) ? asBool(r.display_in_rating) : true),
  }));
}

export function resultsFromCsv(text: string): ResultInput[] {
  const rows = parseCsv(text);
  const required = ["tournament_id", "tournament_name", "tournament_date", "player_id", "place", "participants", "sessions"];
  for (const key of required) {
    if (rows.length && !(key in rows[0])) {
      throw new Error(`results.csv: нет колонки ${key}`);
    }
  }

  if (
    rows.length
    && !("is_status_tournament" in rows[0])
    && !("is_world_europe" in rows[0])
  ) {
    throw new Error("results.csv: нет колонки is_status_tournament");
  }

  return rows.map((r) => ({
    ...r,
    tournament_id: String(r.tournament_id),
    tournament_name: String(r.tournament_name),
    tournament_date: String(r.tournament_date),
    tournament_order: Number(r.tournament_order || 0),
    player_id: String(r.player_id),
    place: Number(r.place),
    participants: Number(r.participants),
    sessions: Number(r.sessions),
    is_status_tournament: asBool(r.is_status_tournament ?? r.is_world_europe),
    is_substitute: asBool(r.is_substitute),
  }));
}

export async function loadCsvPair(playersUrl: string, resultsUrl: string) {
  const [p, r] = await Promise.all([fetch(playersUrl), fetch(resultsUrl)]);
  if (!p.ok || !r.ok) throw new Error("Не удалось загрузить встроенный набор данных");
  return {
    players: playersFromCsv(await p.text()),
    results: resultsFromCsv(await r.text()),
  };
}
