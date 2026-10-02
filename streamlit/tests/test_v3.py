from datetime import date
import pandas as pd
from rating_engine.definitions import LEGACY, TRUESKILL


def sample():
    players = pd.DataFrame([
        {"player_id":"A","player_name":"A","initial_eu":2000,"initial_marks":0,"initial_dan_date":""},
        {"player_id":"B","player_name":"B","initial_eu":0,"initial_marks":0,"initial_dan_date":""},
        {"player_id":"C","player_name":"C","initial_eu":0,"initial_marks":0,"initial_dan_date":""},
        {"player_id":"D","player_name":"D","initial_eu":0,"initial_marks":0,"initial_dan_date":""},
    ])
    rows=[]
    for pid, place in zip(["A","B","C","D"],[1,2,3,4]):
        rows.append({
            "tournament_id":"T1","tournament_name":"T1","tournament_date":"2026-01-01",
            "tournament_order":1,"player_id":pid,"place":place,"participants":4,
            "sessions":5,"is_world_europe":False,
        })
    return players, pd.DataFrame(rows)


def test_legacy_definition():
    p,r = sample()
    out = LEGACY.build().calculate(p,r,date(2026,2,1))
    assert len(out.ranking) == 4
    assert "rating" in out.ranking.columns


def test_trueskill_definition():
    import importlib.util
    if importlib.util.find_spec("trueskill") is None:
        return
    p,r = sample()
    out = TRUESKILL.build().calculate(p,r,date(2026,2,1))
    assert len(out.ranking) == 4
    assert out.ranking.iloc[0]["player_name"] == "A"


def test_defaults():
    d = LEGACY.defaults()
    assert d["eu_weight"] == 0.25
    assert d["top_n"] == 5
