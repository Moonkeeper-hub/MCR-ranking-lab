from datetime import date
import math
import pandas as pd

from rating_engine.legacy import LegacyFormula, LegacyConfig
from rating_engine.evolution import EvolutionEngine, EvolutionState, performed_norm, level_label


def test_norm_rating():
    f = LegacyFormula()
    assert f.norm_rating(1, 100) == 1000
    assert f.norm_rating(100, 100) == 0
    assert round(f.norm_rating(25, 100), 3) == 757.576


def test_eu_component_rounds_down():
    f = LegacyFormula()
    assert math.isclose(f.eu_component(1637), 1.60)


def test_decay():
    f = LegacyFormula()
    assert f.tournament_weight("2026-01-15", date(2026, 1, 20)) == 1.0
    assert f.tournament_weight("2026-01-15", date(2026, 4, 15)) == 0.92
    assert f.tournament_weight("2023-01-15", date(2026, 1, 15)) == 0.0


def test_performed_norm():
    assert performed_norm(2499.9) == 2000
    assert performed_norm(2500) == 2500
    assert performed_norm(3100) == 3000


def test_dan_success_exchange():
    e = EvolutionEngine()
    state = EvolutionState(eu=2500, marks=1, dan_date=date(2026, 1, 1))
    state, norm, info = e.process_performance(state, 3000, date(2026, 2, 1))
    assert state.eu == 3000
    assert state.marks == 0
    assert norm == 3000


def test_d1_is_protected():
    e = EvolutionEngine()
    state = EvolutionState(eu=2000, marks=0, dan_date=None)
    e.add_failure(state)
    e.add_failure(state)
    assert state.eu == 2000
    assert state.marks == 0


def test_expiry_two_years_can_drop_one_step():
    e = EvolutionEngine()
    state = EvolutionState(eu=3000, marks=0, dan_date=date(2024, 1, 1))
    e.expire_until(state, date(2026, 1, 2))
    assert state.eu == 2500


def test_double_strike_does_not_duplicate_same_norm():
    e = EvolutionEngine()
    state = EvolutionState(eu=2500, marks=0, dan_date=date(2026, 1, 1))
    state, processed, info1 = e.process_performance(state, 3000, date(2026, 2, 1), 0)
    assert state.eu == 2500
    assert state.marks == 1
    state, processed, info2 = e.process_performance(state, 3000, date(2026, 2, 1), processed)
    assert state.eu == 2500
    assert state.marks == 1
    assert info2["successes_added"] == 0


def test_full_calculation_smoke():
    players = pd.DataFrame([
        {"player_id":"A","player_name":"A","initial_eu":2000,"initial_marks":0,"initial_dan_date":""},
        {"player_id":"B","player_name":"B","initial_eu":0,"initial_marks":0,"initial_dan_date":""},
    ])
    results = pd.DataFrame([
        {"tournament_id":"T","tournament_name":"T","tournament_date":"2026-01-01",
         "tournament_order":1,"player_id":"A","place":1,"participants":2,"sessions":5,"is_world_europe":False},
        {"tournament_id":"T","tournament_name":"T","tournament_date":"2026-01-01",
         "tournament_order":1,"player_id":"B","place":2,"participants":2,"sessions":5,"is_world_europe":False},
    ])
    out = LegacyFormula().calculate(players, results, date(2026, 2, 1))
    assert len(out.ranking) == 2
    assert len(out.tournament_rows) == 2
