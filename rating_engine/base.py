from __future__ import annotations

from dataclasses import dataclass
import pandas as pd


@dataclass(frozen=True)
class CalculationResult:
    ranking: pd.DataFrame
    tournament_rows: pd.DataFrame
    state_history: pd.DataFrame
