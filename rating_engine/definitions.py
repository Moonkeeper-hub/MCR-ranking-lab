from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .legacy import LegacyFormula, LegacyConfig
from .trueskill_formula import TrueSkillFormula, TrueSkillConfig


@dataclass(frozen=True)
class ParameterSpec:
    key: str
    label: str
    group: str
    control: str
    default: Any
    min_value: float | int | None = None
    max_value: float | int | None = None
    step: float | int | None = None
    options: list[Any] | None = None
    help_key: str | None = None


@dataclass(frozen=True)
class FormulaDefinition:
    id: str
    name: str
    description: str
    config_cls: type
    engine_cls: type
    parameters: list[ParameterSpec]
    formula_blocks: list[dict] = field(default_factory=list)

    def defaults(self):
        return {p.key: p.default for p in self.parameters}

    def build(
        self,
        values: dict | None = None,
        table_overrides: dict | None = None,
    ):
        data = self.defaults()

        if values:
            data.update(values)

        config = self.config_cls(**data)

        if self.id == "legacy":
            return self.engine_cls(
                config,
                table_overrides=table_overrides,
            )

        return self.engine_cls(config)


LEGACY = FormulaDefinition(
    id="legacy",
    name="Legacy",
    description="Реконструкция практики MCR по документам 2018/2026 и комментариям В.И. Новикова.",
    config_cls=LegacyConfig,
    engine_cls=LegacyFormula,
    parameters=[
        ParameterSpec("eu_weight", "Вес EU", "Итоговый рейтинг", "slider", 0.25, 0.0, 1.0, 0.01, help_key="wEU"),
        ParameterSpec("t5_weight", "Вес T5", "Итоговый рейтинг", "slider", 0.75, 0.0, 1.0, 0.01, help_key="wT5"),
        ParameterSpec("top_n", "Число лучших турниров", "Итоговый рейтинг", "slider", 5, 1, 10, 1, help_key="T5"),
        ParameterSpec("session_coef", "Коэффициент за сессию", "Коэффициент турнира", "slider", 0.10, 0.0, 0.30, 0.01, help_key="KT_S"),
        ParameterSpec("player_count_scale", "Вес размера турнира", "Коэффициент турнира", "slider", 1.0, 0.0, 2.0, 0.05, help_key="KT_N"),
        ParameterSpec("eu_component_scale", "Вес силы состава", "Коэффициент турнира", "slider", 1.0, 0.0, 2.0, 0.05, help_key="KT_EU"),
        ParameterSpec("eu_normalizer", "Нормировка среднего EU", "Коэффициент турнира", "number", 1000.0, 100.0, 10000.0, 50.0, help_key="KT_EU"),
        ParameterSpec("eu_round_step", "Округление KT_EU вниз", "Коэффициент турнира", "select_slider", 0.05, options=[0.0, 0.01, 0.05, 0.10, 0.25], help_key="KT_EU"),
        ParameterSpec("world_europe_bonus", "Бонус ЧЕ/ЧМ", "Коэффициент турнира", "slider", 1.0, 0.0, 2.0, 0.05, help_key="KT_W"),
        ParameterSpec("decay_per_quarter", "Угасание за квартал", "Угасание", "slider", 0.08, 0.0, 0.20, 0.01, help_key="VT"),
        ParameterSpec("max_age_months", "Обнуление через, мес.", "Угасание", "slider", 36, 12, 60, 3, help_key="VT"),
        ParameterSpec("double_strike", "Double Strike", "EU / даны", "checkbox", True, help_key="DoubleStrike"),
        ParameterSpec("successes_per_step", "Плюсов на повышение", "EU / даны", "slider", 2, 1, 4, 1, help_key="marks"),
        ParameterSpec("failures_per_step", "Минусов на понижение", "EU / даны", "slider", 2, 1, 4, 1, help_key="marks"),
        ParameterSpec("dan_step", "Шаг дана EU", "EU / даны", "select_slider", 500, options=[250, 500, 750, 1000], help_key="EU"),
        ParameterSpec("confirmation_months", "Подтверждение D2+, мес.", "EU / даны", "slider", 12, 3, 36, 3, help_key="marks"),
        ParameterSpec("protected_eu", "Несгораемый EU", "EU / даны", "select_slider", 2000, options=[1750, 2000, 2500], help_key="EU"),
        ParameterSpec("cap_player_count_component", "Ограничить KT_N после 164", "Техническое", "checkbox", True, help_key="KT_N"),
    ],
    formula_blocks=[
        {"title": "Итоговый рейтинг", "tokens": ["Rating", "=", "wEU", "×", "EU", "+", "wT5", "×", "T5"]},
        {"title": "Лучшие турниры", "tokens": ["T5", "=", "TopN(", "NR", "×", "KT", "×", "VT", ")", "/", "N"]},
        {"title": "Коэффициент турнира", "tokens": ["KT", "=", "KT_S", "+", "KT_N", "+", "KT_EU", "+", "KT_W"]},
        {"title": "Выполнение нормы", "tokens": ["P", "=", "NR", "×", "KT"]},
    ],
)

TRUESKILL = FormulaDefinition(
    id="trueskill",
    name="TrueSkill (эксперимент)",
    description="Экспериментальный байесовский рейтинг: турнир трактуется как многопользовательское ранжированное событие.",
    config_cls=TrueSkillConfig,
    engine_cls=TrueSkillFormula,
    parameters=[
        ParameterSpec("mu0", "Начальное μ", "TrueSkill", "slider", 25.0, 0.0, 50.0, 0.5, help_key="mu"),
        ParameterSpec("sigma0", "Начальное σ", "TrueSkill", "slider", 8.333, 1.0, 20.0, 0.1, help_key="sigma"),
        ParameterSpec("beta", "β: шум результата", "TrueSkill", "slider", 4.167, 0.5, 10.0, 0.1, help_key="beta"),
        ParameterSpec("tau", "τ: динамика навыка", "TrueSkill", "slider", 0.083, 0.0, 1.0, 0.01, help_key="tau"),
        ParameterSpec("draw_probability", "Вероятность ничьи", "TrueSkill", "slider", 0.0, 0.0, 0.25, 0.01, help_key="draw_probability"),
        ParameterSpec("exposure_k", "Exposure k", "TrueSkill", "slider", 3.0, 0.0, 5.0, 0.1, help_key="k"),
    ],
    formula_blocks=[
        {"title": "Публикуемый score", "tokens": ["TS_score", "=", "mu", "−", "k", "×", "sigma"]},
        {"title": "Обновление после турнира", "tokens": ["BayesUpdate", "(", "mu", ",", "sigma", ",", "rank", ")"]},
    ],
)

FORMULAS = {f.id: f for f in (LEGACY, TRUESKILL)}
