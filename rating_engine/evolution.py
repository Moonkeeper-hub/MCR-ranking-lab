from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import math
import pandas as pd


# Актуальная шкала из черновика Приложения 2 (2026):
# 12–7 кю: 0..250 шаг 50; 6–1 кю: 500..1750 шаг 250;
# 1–12 дан: 2000..7500 шаг 500.
LEVELS = [
    (0, "12 кю"),
    (50, "11 кю"),
    (100, "10 кю"),
    (150, "9 кю"),
    (200, "8 кю"),
    (250, "7 кю"),
    (500, "6 кю"),
    (750, "5 кю"),
    (1000, "4 кю"),
    (1250, "3 кю"),
    (1500, "2 кю"),
    (1750, "1 кю"),
    (2000, "1 дан"),
    (2500, "2 дан"),
    (3000, "3 дан"),
    (3500, "4 дан"),
    (4000, "5 дан"),
    (4500, "6 дан"),
    (5000, "7 дан"),
    (5500, "8 дан"),
    (6000, "9 дан"),
    (6500, "10 дан"),
    (7000, "11 дан"),
    (7500, "12 дан"),
]
LEVEL_VALUES = [v for v, _ in LEVELS]
LEVEL_LABELS = dict(LEVELS)


def to_date(value) -> date | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    return pd.to_datetime(value).date()


def performed_norm(value: float) -> int:
    """Максимальный уровень, порог которого достигнут показателем NR*KT."""
    eligible = [level for level in LEVEL_VALUES if level <= float(value)]
    return max(eligible) if eligible else 0


def level_label(eu: int, marks: int = 0) -> str:
    label = LEVEL_LABELS.get(int(eu), f"EU {int(eu)}")
    if eu >= 2000:
        if marks > 0:
            label += "+" * marks
        elif marks < 0:
            label += "-" * abs(marks)
    return label


@dataclass
class EvolutionState:
    eu: int = 0
    marks: int = 0
    dan_date: date | None = None

    def copy(self) -> "EvolutionState":
        return EvolutionState(self.eu, self.marks, self.dan_date)

    @property
    def label(self) -> str:
        return level_label(self.eu, self.marks)


class EvolutionEngine:
    """
    State machine для Legacy EU.

    Практика, зафиксированная в материалах:
    - до 1 дана включительно достигнутый уровень несгораемый;
    - в дановой зоне каждые 500 очков превышения выполненной нормы над
      текущим EU дают один «успех»;
    - 2 успеха = +1 ступень (+500 EU);
    - 2 неуспеха = -1 ступень (-500 EU), но ниже D1 не опускаемся;
    - «+» и «-» взаимно уничтожаются;
    - подтверждение текущего дана обнуляет отрицательные отметки;
    - D2+ требует подтверждения раз в год;
    - Double Strike: турнир обсчитывается дважды; на втором проходе
      учитывается EU, полученный на первом.

    Неоднозначность источника:
    повторный проход не должен повторно начислять те же успехи за ту же
    уже учтённую выполненную норму. Поэтому process_performance принимает
    processed_norm и начисляет только новые пересечённые пороги.
    """

    def __init__(
        self,
        successes_per_step: int = 2,
        failures_per_step: int = 2,
        dan_step: int = 500,
        confirmation_months: int = 12,
        protected_eu: int = 2000,
    ):
        self.successes_per_step = int(successes_per_step)
        self.failures_per_step = int(failures_per_step)
        self.dan_step = int(dan_step)
        self.confirmation_months = int(confirmation_months)
        self.protected_eu = int(protected_eu)

    @staticmethod
    def _add_months(d: date, months: int) -> date:
        ts = pd.Timestamp(d) + pd.DateOffset(months=months)
        return ts.date()

    def normalize_marks(self, state: EvolutionState) -> EvolutionState:
        # Немедленный «размен» двух знаков на ступень.
        while state.marks >= self.successes_per_step:
            if state.eu < 7500:
                state.eu = min(7500, state.eu + self.dan_step)
            state.marks -= self.successes_per_step

        while state.marks <= -self.failures_per_step:
            if state.eu > self.protected_eu:
                state.eu = max(self.protected_eu, state.eu - self.dan_step)
            state.marks += self.failures_per_step

        if state.eu <= self.protected_eu and state.marks < 0:
            state.marks = 0

        if state.eu < 2500:
            state.dan_date = None

        return state

    def add_successes(self, state: EvolutionState, count: int) -> EvolutionState:
        for _ in range(max(0, int(count))):
            if state.marks < 0:
                state.marks += 1
            else:
                state.marks += 1
            self.normalize_marks(state)
        return state

    def add_failure(self, state: EvolutionState) -> EvolutionState:
        # Неподтверждение: сначала снимает '+', затем добавляет '-'.
        if state.marks > 0:
            state.marks -= 1
        else:
            state.marks -= 1
        return self.normalize_marks(state)

    def expire_until(self, state: EvolutionState, target_date) -> EvolutionState:
        """
        Перед расчётом турнира / выпуска рейтинга начисляем годовые неуспехи D2+.
        В комментариях Новикова проверка делалась на дату выпуска; для
        хронологического движка эквивалентно обрабатываем истёкшие годовщины.
        """
        target = to_date(target_date)
        if target is None or state.eu < 2500 or state.dan_date is None:
            return state

        next_due = self._add_months(state.dan_date, self.confirmation_months)
        while next_due <= target and state.eu >= 2500 and state.dan_date is not None:
            self.add_failure(state)
            if state.eu >= 2500:
                state.dan_date = next_due
                next_due = self._add_months(state.dan_date, self.confirmation_months)
            else:
                state.dan_date = None
                break
        return state

    def process_performance(
        self,
        state: EvolutionState,
        performance: float,
        tournament_date,
        processed_norm: int = 0,
    ) -> tuple[EvolutionState, int, dict]:
        """
        Применить NR*KT к EU.

        processed_norm — максимальная норма, уже учтённая на предыдущем
        проходе того же турнира. Нужна для Double Strike.
        """
        d = to_date(tournament_date)
        norm = performed_norm(performance)
        before = state.copy()
        success_count = 0
        confirmed = False

        # Кю + D1: достигнутый уровень до 2000 фиксируется пожизненно.
        permanent = min(norm, self.protected_eu)
        if permanent > state.eu:
            state.eu = permanent
            state.marks = 0
            if state.eu < 2500:
                state.dan_date = None

        # Если игрок уже D2+, результат >= текущего EU подтверждает дан.
        if state.eu >= 2500 and norm >= state.eu:
            confirmed = True
            if state.marks < 0:
                state.marks = 0
            state.dan_date = d

        # Дановые успехи. Для первого прохода считаем пороги выше текущего EU.
        # Для второго — только пороги, которые ещё не были учтены этим турниром.
        start_threshold = max(self.protected_eu, before.eu, processed_norm)
        if norm > start_threshold:
            success_count = max(0, (norm - start_threshold) // self.dan_step)
            self.add_successes(state, success_count)
            if state.eu >= 2500:
                state.dan_date = d

        self.normalize_marks(state)

        info = {
            "norm": norm,
            "successes_added": int(success_count),
            "confirmed": bool(confirmed),
            "eu_before_action": before.eu,
            "marks_before_action": before.marks,
            "eu_after_action": state.eu,
            "marks_after_action": state.marks,
        }
        return state, max(processed_norm, norm), info
