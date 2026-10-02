from __future__ import annotations

from dataclasses import dataclass
import pandas as pd

from .base import CalculationResult


@dataclass(frozen=True)
class TrueSkillConfig:
    mu0: float = 25.0
    sigma0: float = 8.333
    beta: float = 4.167
    tau: float = 0.083
    draw_probability: float = 0.0
    exposure_k: float = 3.0


class TrueSkillFormula:
    name = "TrueSkill (эксперимент)"

    def __init__(self, config: TrueSkillConfig | None = None):
        self.config = config or TrueSkillConfig()

    def calculate(self, players, results, evaluation_date):
        try:
            import trueskill
        except ImportError as exc:
            raise RuntimeError("Для TrueSkill установите зависимость: pip install trueskill") from exc
        cfg = self.config
        env = trueskill.TrueSkill(
            mu=cfg.mu0,
            sigma=cfg.sigma0,
            beta=cfg.beta,
            tau=cfg.tau,
            draw_probability=cfg.draw_probability,
        )

        p = players.copy()
        r = results.copy()
        p["player_id"] = p["player_id"].astype(str)
        r["player_id"] = r["player_id"].astype(str)
        r["tournament_date"] = pd.to_datetime(r["tournament_date"]).dt.date
        if "tournament_order" not in r.columns:
            r["tournament_order"] = 0

        ratings = {pid: env.create_rating() for pid in p["player_id"]}
        names = p.set_index("player_id")["player_name"].to_dict()
        history = []

        meta = (
            r[["tournament_id", "tournament_name", "tournament_date", "tournament_order"]]
            .drop_duplicates("tournament_id")
            .sort_values(["tournament_date", "tournament_order", "tournament_id"])
        )

        for t in meta.itertuples(index=False):
            sub = r[r["tournament_id"] == t.tournament_id].sort_values("place")
            groups, ranks, pids = [], [], []
            for row in sub.itertuples(index=False):
                pid = str(row.player_id)
                ratings.setdefault(pid, env.create_rating())
                groups.append((ratings[pid],))
                ranks.append(int(row.place) - 1)
                pids.append(pid)

            updated = env.rate(groups, ranks=ranks)
            for pid, group in zip(pids, updated):
                before = ratings[pid]
                after = group[0]
                ratings[pid] = after
                history.append({
                    "date": t.tournament_date,
                    "event": "tournament",
                    "tournament_id": t.tournament_id,
                    "player_id": pid,
                    "mu_before": before.mu,
                    "sigma_before": before.sigma,
                    "mu_after": after.mu,
                    "sigma_after": after.sigma,
                    "note": t.tournament_name,
                })

        ranking_rows = []
        for pid, rating in ratings.items():
            score = rating.mu - cfg.exposure_k * rating.sigma
            ranking_rows.append({
                "player_id": pid,
                "player_name": names.get(pid, pid),
                "rating": score,
                "mu": rating.mu,
                "sigma": rating.sigma,
                "level": "",
                "current_eu": float("nan"),
                "t5": float("nan"),
                "tournaments_count": int((r["player_id"] == pid).sum()),
            })

        ranking = pd.DataFrame(ranking_rows).sort_values(
            ["rating", "player_name"], ascending=[False, True]
        ).reset_index(drop=True)
        ranking["rank"] = ranking.index + 1

        return CalculationResult(
            ranking=ranking,
            tournament_rows=pd.DataFrame(),
            state_history=pd.DataFrame(history),
        )
