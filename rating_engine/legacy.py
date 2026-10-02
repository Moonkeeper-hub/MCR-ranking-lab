from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime
import math
import pandas as pd

from .base import CalculationResult
from .evolution import EvolutionEngine, EvolutionState, level_label, to_date



@dataclass(frozen=True)
class LegacyConfig:
    # Финальная формула
    eu_weight: float = 0.25
    t5_weight: float = 0.75
    top_n: int = 5

    # КТ
    session_coef: float = 0.10
    player_count_scale: float = 1.00
    eu_component_scale: float = 1.00
    eu_normalizer: float = 1000.0
    eu_round_step: float = 0.05
    world_europe_bonus: float = 1.00

    # ВТ
    decay_per_quarter: float = 0.08
    max_age_months: int = 36

    # EU / дановая механика
    double_strike: bool = True
    successes_per_step: int = 2
    failures_per_step: int = 2
    dan_step: int = 500
    confirmation_months: int = 12
    protected_eu: int = 2000

    # Технические допущения
    cap_player_count_component: bool = True


class LegacyFormula:
    name = "Legacy"

    def __init__(self, config: LegacyConfig | None = None):
        self.config = config or LegacyConfig()
        self.evolution = EvolutionEngine(
            successes_per_step=self.config.successes_per_step,
            failures_per_step=self.config.failures_per_step,
            dan_step=self.config.dan_step,
            confirmation_months=self.config.confirmation_months,
            protected_eu=self.config.protected_eu,
        )

    def with_config(self, **kwargs) -> "LegacyFormula":
        return LegacyFormula(replace(self.config, **kwargs))

    @staticmethod
    def _to_date(value) -> date:
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        if isinstance(value, datetime):
            return value.date()
        return pd.to_datetime(value).date()

    @staticmethod
    def norm_rating(place: int, participants: int) -> float:
        if participants <= 1:
            raise ValueError("participants must be > 1")
        if place < 1 or place > participants:
            raise ValueError("place must be between 1 and participants")
        return 1000.0 * (participants - place) / (participants - 1)

    def player_count_component(self, participants: int) -> float:
        cfg = self.config
        if participants in KT_PARTICIPANTS:
            return KT_PARTICIPANTS[participants] * cfg.player_count_scale

        keys = sorted(KT_PARTICIPANTS)
        if participants < keys[0]:
            return KT_PARTICIPANTS[keys[0]] * cfg.player_count_scale
        if participants > keys[-1]:
            if cfg.cap_player_count_component:
                return KT_PARTICIPANTS[keys[-1]] * cfg.player_count_scale
            raise ValueError(f"Для {participants} участников в Legacy-таблице нет значения.")

        lower = max(k for k in keys if k < participants)
        upper = min(k for k in keys if k > participants)
        y0, y1 = KT_PARTICIPANTS[lower], KT_PARTICIPANTS[upper]
        base = y0 + (y1 - y0) * ((participants - lower) / (upper - lower))
        return base * cfg.player_count_scale

    def eu_component(self, mean_eu: float) -> float:
        cfg = self.config
        raw = (float(mean_eu) / cfg.eu_normalizer) * cfg.eu_component_scale
        step = cfg.eu_round_step
        if step <= 0:
            return raw
        return math.floor((raw + 1e-12) / step) * step

    def tournament_coefficient(self, sessions, participants, mean_eu, is_world_europe):
        cfg = self.config
        kt_sessions = float(sessions) * cfg.session_coef
        kt_players = self.player_count_component(int(participants))
        kt_eu = self.eu_component(float(mean_eu))
        kt_world = cfg.world_europe_bonus if bool(is_world_europe) else 0.0
        kt = kt_sessions + kt_players + kt_eu + kt_world
        return {
            "kt_sessions": kt_sessions,
            "kt_players": kt_players,
            "kt_eu": kt_eu,
            "kt_world": kt_world,
            "kt": kt,
        }

    @staticmethod
    def age_months(tournament_date, evaluation_date) -> int:
        t = LegacyFormula._to_date(tournament_date)
        e = LegacyFormula._to_date(evaluation_date)
        months = (e.year - t.year) * 12 + (e.month - t.month)
        if e.day < t.day:
            months -= 1
        return max(0, months)

    def tournament_weight(self, tournament_date, evaluation_date) -> float:
        cfg = self.config
        months = self.age_months(tournament_date, evaluation_date)
        if months >= cfg.max_age_months:
            return 0.0
        return max(0.0, 1.0 - cfg.decay_per_quarter * (months // 3))

    def _prepare_players(self, players: pd.DataFrame) -> pd.DataFrame:
        p = players.copy()
        required = {"player_id", "player_name"}
        missing = required - set(p.columns)
        if missing:
            raise ValueError(f"players.csv: missing columns: {sorted(missing)}")

        # Совместимость с первой версией MVP.
        if "initial_eu" not in p.columns:
            p["initial_eu"] = p["current_eu"] if "current_eu" in p.columns else 0
        if "initial_marks" not in p.columns:
            p["initial_marks"] = 0
        if "initial_dan_date" not in p.columns:
            p["initial_dan_date"] = ""

        p["player_id"] = p["player_id"].astype(str)
        p["initial_eu"] = p["initial_eu"].fillna(0).astype(int)
        p["initial_marks"] = p["initial_marks"].fillna(0).astype(int)
        return p

    def _prepare_results(self, results: pd.DataFrame) -> pd.DataFrame:
        r = results.copy()
        required = {
            "tournament_id", "tournament_name", "tournament_date", "player_id",
            "place", "participants", "sessions", "is_world_europe",
        }
        missing = required - set(r.columns)
        if missing:
            raise ValueError(f"results.csv: missing columns: {sorted(missing)}")

        r["player_id"] = r["player_id"].astype(str)
        r["tournament_date"] = pd.to_datetime(r["tournament_date"]).dt.date
        if "tournament_order" not in r.columns:
            r["tournament_order"] = 0
        return r

    def calculate(self, players, results, evaluation_date) -> CalculationResult:
        cfg = self.config
        p = self._prepare_players(players)
        r = self._prepare_results(results)
        evaluation_date = self._to_date(evaluation_date)

        states: dict[str, EvolutionState] = {}
        for row in p.itertuples(index=False):
            states[str(row.player_id)] = EvolutionState(
                eu=int(row.initial_eu),
                marks=int(row.initial_marks),
                dan_date=to_date(row.initial_dan_date),
            )

        # Игроки, которых нет в players.csv, трактуются как новые (EU=0).
        for pid in r["player_id"].unique():
            states.setdefault(str(pid), EvolutionState())

        tournament_meta = (
            r[[
                "tournament_id", "tournament_name", "tournament_date",
                "participants", "sessions", "is_world_europe", "tournament_order"
            ]]
            .drop_duplicates("tournament_id")
            .sort_values(["tournament_date", "tournament_order", "tournament_id"])
        )

        detail_rows = []
        history_rows = []

        for t in tournament_meta.itertuples(index=False):
            tid = t.tournament_id
            tdate = t.tournament_date
            sub = r[r["tournament_id"] == tid].copy()

            # Перед турниром применяем истёкшие годовые проверки D2+.
            for pid in list(states):
                before = states[pid].copy()
                self.evolution.expire_until(states[pid], tdate)
                after = states[pid]
                if (before.eu, before.marks, before.dan_date) != (after.eu, after.marks, after.dan_date):
                    history_rows.append({
                        "date": tdate,
                        "event": "expiry",
                        "tournament_id": tid,
                        "player_id": pid,
                        "eu_before": before.eu,
                        "marks_before": before.marks,
                        "eu_after": after.eu,
                        "marks_after": after.marks,
                        "label_after": after.label,
                        "note": "Годовое неподтверждение D2+ перед расчётом турнира",
                    })

            # Snapshot до турнира.
            eu_before_map = {pid: st.eu for pid, st in states.items()}
            marks_before_map = {pid: st.marks for pid, st in states.items()}
            label_before_map = {pid: st.label for pid, st in states.items()}
            dan_date_before_map = {pid: st.dan_date for pid, st in states.items()}

            # KT_EU считается по участникам турнира.
            participant_eus = [states[str(pid)].eu for pid in sub["player_id"]]
            mean_eu_pass1 = sum(participant_eus) / len(participant_eus) if participant_eus else 0.0
            kt1 = self.tournament_coefficient(
                t.sessions, t.participants, mean_eu_pass1, t.is_world_europe
            )

            processed_norm = {str(pid): 0 for pid in sub["player_id"]}
            pass1_info = {}

            # Первый расчёт.
            for row in sub.itertuples(index=False):
                pid = str(row.player_id)
                nr = self.norm_rating(int(row.place), int(row.participants))
                perf = nr * kt1["kt"]
                states[pid], processed_norm[pid], info = self.evolution.process_performance(
                    states[pid], perf, tdate, processed_norm=0
                )
                pass1_info[pid] = {"nr": nr, "performance": perf, **info}

            # Второй расчёт по практике Double Strike.
            if cfg.double_strike:
                participant_eus_2 = [states[str(pid)].eu for pid in sub["player_id"]]
                mean_eu_final = (
                    sum(participant_eus_2) / len(participant_eus_2)
                    if participant_eus_2 else 0.0
                )
                kt_final = self.tournament_coefficient(
                    t.sessions, t.participants, mean_eu_final, t.is_world_europe
                )

                pass2_info = {}
                for row in sub.itertuples(index=False):
                    pid = str(row.player_id)
                    nr = self.norm_rating(int(row.place), int(row.participants))
                    perf = nr * kt_final["kt"]
                    states[pid], processed_norm[pid], info = self.evolution.process_performance(
                        states[pid], perf, tdate, processed_norm=processed_norm[pid]
                    )
                    pass2_info[pid] = {"nr": nr, "performance": perf, **info}
            else:
                mean_eu_final = mean_eu_pass1
                kt_final = kt1
                pass2_info = {}

            # Финальные турнирные показатели для рейтинга.
            vt = self.tournament_weight(tdate, evaluation_date)
            for row in sub.itertuples(index=False):
                pid = str(row.player_id)
                nr = self.norm_rating(int(row.place), int(row.participants))
                nrkt = nr * kt_final["kt"]
                nrktvt = nrkt * vt
                p1 = pass1_info.get(pid, {})
                p2 = pass2_info.get(pid, {})

                detail_rows.append({
                    **row._asdict(),
                    "eu_before": eu_before_map[pid],
                    "marks_before": marks_before_map[pid],
                    "level_before": label_before_map[pid],
                    "dan_date_before": dan_date_before_map[pid],
                    "mean_eu_pass1": mean_eu_pass1,
                    "kt_pass1": kt1["kt"],
                    "norm_pass1": p1.get("norm", 0),
                    "successes_pass1": p1.get("successes_added", 0),
                    "mean_eu_final": mean_eu_final,
                    "kt_sessions": kt_final["kt_sessions"],
                    "kt_players": kt_final["kt_players"],
                    "kt_eu": kt_final["kt_eu"],
                    "kt_world": kt_final["kt_world"],
                    "kt": kt_final["kt"],
                    "norm_final": p2.get("norm", p1.get("norm", 0)),
                    "successes_pass2": p2.get("successes_added", 0),
                    "eu_after": states[pid].eu,
                    "marks_after": states[pid].marks,
                    "level_after": states[pid].label,
                    "dan_date_after": states[pid].dan_date,
                    "nr": nr,
                    "vt": vt,
                    "nrkt": nrkt,
                    "nrktvt": nrktvt,
                })

                history_rows.append({
                    "date": tdate,
                    "event": "tournament",
                    "tournament_id": tid,
                    "player_id": pid,
                    "eu_before": eu_before_map[pid],
                    "marks_before": marks_before_map[pid],
                    "eu_after": states[pid].eu,
                    "marks_after": states[pid].marks,
                    "label_after": states[pid].label,
                    "note": f"{t.tournament_name}; норма {p2.get('norm', p1.get('norm', 0))}",
                })

        # На дату выпуска применяем годовые истечения для всех игроков.
        for pid, state in states.items():
            before = state.copy()
            self.evolution.expire_until(state, evaluation_date)
            if (before.eu, before.marks, before.dan_date) != (state.eu, state.marks, state.dan_date):
                history_rows.append({
                    "date": evaluation_date,
                    "event": "expiry",
                    "tournament_id": None,
                    "player_id": pid,
                    "eu_before": before.eu,
                    "marks_before": before.marks,
                    "eu_after": state.eu,
                    "marks_after": state.marks,
                    "label_after": state.label,
                    "note": "Годовое неподтверждение D2+ на дату выпуска рейтинга",
                })

        detail = pd.DataFrame(detail_rows)
        history = pd.DataFrame(history_rows)

        ranking_rows = []
        names = p.set_index("player_id")["player_name"].to_dict()

        for pid, state in states.items():
            sub = detail[detail["player_id"].astype(str) == str(pid)].copy()
            sub = sub.sort_values("nrktvt", ascending=False)
            top = sub.head(cfg.top_n)
            tn = float(top["nrktvt"].sum()) / cfg.top_n if cfg.top_n else 0.0
            rating = cfg.eu_weight * state.eu + cfg.t5_weight * tn
            ranking_rows.append({
                "player_id": pid,
                "player_name": names.get(pid, pid),
                "current_eu": state.eu,
                "marks": state.marks,
                "level": state.label,
                "dan_date": state.dan_date,
                "t5": tn,
                "rating": rating,
                "tournaments_count": int(len(sub)),
            })

        ranking = pd.DataFrame(ranking_rows)
        ranking = ranking.sort_values(
            ["rating", "player_name"], ascending=[False, True]
        ).reset_index(drop=True)
        ranking["rank"] = ranking.index + 1

        return CalculationResult(
            ranking=ranking,
            tournament_rows=detail,
            state_history=history,
        )
