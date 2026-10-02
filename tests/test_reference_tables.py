import pytest
from rating_engine.legacy_tables import (
    LEGACY_LEVELS, EU_TO_LEVEL, KT_PARTICIPANTS,
    LEGACY_AGE_WEIGHTS, LEGACY_FIXED_DEFAULTS
)

def test_levels():
    assert LEGACY_LEVELS[0].label == "12 кю"
    assert EU_TO_LEVEL[2000].label == "1 дан"
    assert LEGACY_LEVELS[-1].label == "12 дан"

def test_kt_table():
    assert KT_PARTICIPANTS[12] == -0.20
    assert KT_PARTICIPANTS[80] == 1.00
    assert KT_PARTICIPANTS[164] == 1.50

def test_age_table():
    assert LEGACY_AGE_WEIGHTS[0].weight == 1.00
    assert LEGACY_AGE_WEIGHTS[-1].min_months == 36
    assert LEGACY_AGE_WEIGHTS[-1].weight == 0.00

def test_mapping_proxy_is_immutable():
    with pytest.raises(TypeError):
        KT_PARTICIPANTS[12] = 999

def test_defaults():
    assert LEGACY_FIXED_DEFAULTS["rating_eu_weight"] == 0.25
    assert LEGACY_FIXED_DEFAULTS["rating_t5_weight"] == 0.75
