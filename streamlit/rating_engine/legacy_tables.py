from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class LegacyLevel:
    eu: int
    label: str
    kind: str
    ordinal: int


LEGACY_LEVELS: tuple[LegacyLevel, ...] = (
    LegacyLevel(0, "12 кю", "kyu", 12),
    LegacyLevel(50, "11 кю", "kyu", 11),
    LegacyLevel(100, "10 кю", "kyu", 10),
    LegacyLevel(150, "9 кю", "kyu", 9),
    LegacyLevel(200, "8 кю", "kyu", 8),
    LegacyLevel(250, "7 кю", "kyu", 7),
    LegacyLevel(500, "6 кю", "kyu", 6),
    LegacyLevel(750, "5 кю", "kyu", 5),
    LegacyLevel(1000, "4 кю", "kyu", 4),
    LegacyLevel(1250, "3 кю", "kyu", 3),
    LegacyLevel(1500, "2 кю", "kyu", 2),
    LegacyLevel(1750, "1 кю", "kyu", 1),
    LegacyLevel(2000, "1 дан", "dan", 1),
    LegacyLevel(2500, "2 дан", "dan", 2),
    LegacyLevel(3000, "3 дан", "dan", 3),
    LegacyLevel(3500, "4 дан", "dan", 4),
    LegacyLevel(4000, "5 дан", "dan", 5),
    LegacyLevel(4500, "6 дан", "dan", 6),
    LegacyLevel(5000, "7 дан", "dan", 7),
    LegacyLevel(5500, "8 дан", "dan", 8),
    LegacyLevel(6000, "9 дан", "dan", 9),
    LegacyLevel(6500, "10 дан", "dan", 10),
    LegacyLevel(7000, "11 дан", "dan", 11),
    LegacyLevel(7500, "12 дан", "dan", 12),
)

EU_TO_LEVEL = MappingProxyType({x.eu: x for x in LEGACY_LEVELS})
LEVEL_VALUES: tuple[int, ...] = tuple(x.eu for x in LEGACY_LEVELS)

_KT_PARTICIPANTS = {
    12: -0.20, 16: -0.10, 20: 0.00, 24: 0.10, 28: 0.20, 32: 0.30,
    36: 0.40, 40: 0.50, 44: 0.55, 48: 0.65, 52: 0.70, 56: 0.75,
    60: 0.80, 64: 0.85, 68: 0.90, 72: 0.90, 76: 0.95, 80: 1.00,
    84: 1.05, 88: 1.05, 92: 1.10, 96: 1.15, 100: 1.15,
    104: 1.20, 108: 1.20, 112: 1.25, 116: 1.25, 120: 1.30,
    124: 1.30, 128: 1.35, 132: 1.35, 136: 1.40, 140: 1.40,
    144: 1.40, 148: 1.45, 152: 1.45, 156: 1.50, 160: 1.50, 164: 1.50,
}
KT_PARTICIPANTS = MappingProxyType(_KT_PARTICIPANTS)


@dataclass(frozen=True)
class AgeWeight:
    min_months: int
    max_months: int | None
    weight: float


LEGACY_AGE_WEIGHTS: tuple[AgeWeight, ...] = (
    AgeWeight(0, 2, 1.00),
    AgeWeight(3, 5, 0.92),
    AgeWeight(6, 8, 0.84),
    AgeWeight(9, 11, 0.76),
    AgeWeight(12, 14, 0.68),
    AgeWeight(15, 17, 0.60),
    AgeWeight(18, 20, 0.52),
    AgeWeight(21, 23, 0.44),
    AgeWeight(24, 26, 0.36),
    AgeWeight(27, 29, 0.28),
    AgeWeight(30, 32, 0.20),
    AgeWeight(33, 35, 0.12),
    AgeWeight(36, None, 0.00),
)

TOURNAMENT_STATUS_BONUS = MappingProxyType({
    "ordinary": 0.00,
    "world_or_europe": 1.00,
})

LEGACY_FIXED_DEFAULTS = MappingProxyType({
    "rating_eu_weight": 0.25,
    "rating_t5_weight": 0.75,
    "top_tournaments": 5,
    "session_coefficient": 0.10,
    "eu_normalizer": 1000.0,
    "eu_round_down_step": 0.05,
    "dan_step_eu": 500,
    "successes_per_dan_step": 2,
    "failures_per_dan_step": 2,
    "dan_confirmation_months": 12,
    "protected_eu": 2000,
})
