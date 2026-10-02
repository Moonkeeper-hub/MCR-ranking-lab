from __future__ import annotations

from datetime import date
import json
import math
import pandas as pd
import streamlit as st

from rating_engine.definitions import FORMULAS
from formula_component import formula_picker

st.set_page_config(page_title="MCR Rating Lab", layout="wide")


@st.cache_data
def load_sample():
    players = pd.read_csv("data/players.csv", dtype={"player_id": str})
    results = pd.read_csv("data/results.csv", dtype={"player_id": str})
    return players, results


@st.cache_data
def load_help():
    with open("formula_help.json", "r", encoding="utf-8") as f:
        return json.load(f)


def state_key(formula_id):
    return f"params::{formula_id}"


def ensure_formula_state(formula_id):
    if state_key(formula_id) not in st.session_state:
        st.session_state[state_key(formula_id)] = FORMULAS[formula_id].defaults().copy()
    return st.session_state[state_key(formula_id)]


def get_param(formula_id, key):
    return ensure_formula_state(formula_id)[key]


def set_param(formula_id, key, value):
    ensure_formula_state(formula_id)[key] = value


def reset_formula(formula_id):
    st.session_state[state_key(formula_id)] = FORMULAS[formula_id].defaults().copy()
    _clear_formula_widget_state(formula_id)


def get_spec(formula_id, key):
    for spec in FORMULAS[formula_id].parameters:
        if spec.key == key:
            return spec
    return None


def _sync_legacy_weight_widgets(changed_key, changed_widget_key):
    """Keep EU/T5 weights complementary in every visible control."""
    value = round(float(st.session_state[changed_widget_key]), 2)
    value = min(1.0, max(0.0, value))
    other_key = "t5_weight" if changed_key == "eu_weight" else "eu_weight"
    other_value = round(1.0 - value, 2)

    params = ensure_formula_state("legacy")
    params[changed_key] = value
    params[other_key] = other_value

    # The same parameter can be rendered in the sidebar and in the formula card.
    # Update any already-created counterpart widget so both sliders visibly mirror.
    for prefix in ("sidebar", "formula_card"):
        own_widget = f"{prefix}::legacy::{changed_key}"
        other_widget = f"{prefix}::legacy::{other_key}"
        if own_widget in st.session_state and own_widget != changed_widget_key:
            st.session_state[own_widget] = value
        if other_widget in st.session_state:
            st.session_state[other_widget] = other_value


def _clear_formula_widget_state(formula_id):
    prefixes = ("sidebar", "formula_card")
    for spec in FORMULAS[formula_id].parameters:
        for prefix in prefixes:
            st.session_state.pop(f"{prefix}::{formula_id}::{spec.key}", None)


def render_control(formula_id, spec, prefix, compact=False):
    value = get_param(formula_id, spec.key)
    widget_key = f"{prefix}::{formula_id}::{spec.key}"

    # If another mirrored control changed the canonical value, seed this widget
    # with that value before rendering it.
    if widget_key in st.session_state and st.session_state[widget_key] != value:
        st.session_state[widget_key] = value

    callback = None
    callback_args = ()
    if formula_id == "legacy" and spec.key in ("eu_weight", "t5_weight"):
        callback = _sync_legacy_weight_widgets
        callback_args = (spec.key, widget_key)

    common = {
        "key": widget_key,
    }
    if callback:
        common["on_change"] = callback
        common["args"] = callback_args

    if spec.control == "slider":
        new = st.slider(
            spec.label, spec.min_value, spec.max_value, value, spec.step, **common
        )
    elif spec.control == "number":
        new = st.number_input(
            spec.label, spec.min_value, spec.max_value, value, spec.step, **common
        )
    elif spec.control == "select_slider":
        new = st.select_slider(spec.label, options=spec.options, value=value, **common)
    elif spec.control == "checkbox":
        new = st.checkbox(spec.label, value=bool(value), **common)
    else:
        new = value

    set_param(formula_id, spec.key, new)

    # Defensive invariant even if a value arrives from a future non-UI source.
    if formula_id == "legacy" and spec.key in ("eu_weight", "t5_weight"):
        other_key = "t5_weight" if spec.key == "eu_weight" else "eu_weight"
        set_param(formula_id, other_key, round(1.0 - float(new), 2))

    return new


def normalize_ranking(df):
    out = df.copy()
    for col, default in {
        "level": "", "current_eu": float("nan"), "t5": float("nan"),
        "mu": float("nan"), "sigma": float("nan")
    }.items():
        if col not in out.columns:
            out[col] = default
    return out


def compare_rankings(current, reference):
    c = normalize_ranking(current.ranking)
    r = normalize_ranking(reference.ranking)

    c = c[["player_id", "player_name", "rank", "rating", "level", "current_eu", "t5", "mu", "sigma"]].rename(columns={
        "rank": "rank_current", "rating": "rating_current", "level": "level_current",
        "current_eu": "eu_current", "t5": "t5_current", "mu": "mu_current", "sigma": "sigma_current",
    })
    r = r[["player_id", "rank", "rating", "level", "current_eu", "t5", "mu", "sigma"]].rename(columns={
        "rank": "rank_ref", "rating": "rating_ref", "level": "level_ref",
        "current_eu": "eu_ref", "t5": "t5_ref", "mu": "mu_ref", "sigma": "sigma_ref",
    })
    merged = c.merge(r, on="player_id", how="outer")
    merged["delta_rating"] = merged["rating_current"] - merged["rating_ref"]
    merged["delta_rank"] = merged["rank_ref"] - merged["rank_current"]
    return merged.sort_values("rank_current")


help_data = load_help()
players, results = load_sample()

# ---------------- sidebar ----------------
st.sidebar.title("Эксперимент")
formula_ids = list(FORMULAS.keys())
current_formula_id = st.sidebar.selectbox(
    "Текущая формула", formula_ids,
    format_func=lambda x: FORMULAS[x].name,
)
reference_formula_id = st.sidebar.selectbox(
    "Эталон", formula_ids,
    index=0,
    format_func=lambda x: FORMULAS[x].name + " default",
)

current_def = FORMULAS[current_formula_id]
ensure_formula_state(current_formula_id)
st.sidebar.caption(current_def.description)

if st.sidebar.button("Сбросить текущую формулу к default", width="stretch"):
    reset_formula(current_formula_id)
    st.rerun()

for group in dict.fromkeys(p.group for p in current_def.parameters):
    with st.sidebar.expander(group, expanded=(group in ["Итоговый рейтинг", "TrueSkill"])):
        for spec in [p for p in current_def.parameters if p.group == group]:
            render_control(current_formula_id, spec, "sidebar")
        if current_formula_id == "legacy" and group == "Итоговый рейтинг":
            st.caption(
                f"Σ весов = {get_param('legacy', 'eu_weight') + get_param('legacy', 't5_weight'):.2f} "
                "— изменение одного веса автоматически меняет второй."
            )

st.sidebar.divider()
st.sidebar.subheader("Данные")
source = st.sidebar.radio("Источник", ["Тестовые данные", "Загрузить CSV"])
if source == "Загрузить CSV":
    pf = st.sidebar.file_uploader("players.csv", type=["csv"])
    rf = st.sidebar.file_uploader("results.csv", type=["csv"])
    if pf and rf:
        players = pd.read_csv(pf, dtype={"player_id": str})
        results = pd.read_csv(rf, dtype={"player_id": str})
    else:
        st.sidebar.info("Пока используются тестовые данные.")

latest = pd.to_datetime(results["tournament_date"]).max().date()
evaluation_date = st.sidebar.date_input("Дата расчёта", max(latest, date.today()))

# ---------------- header / formula ----------------
st.title("MCR Rating Lab")
st.caption("Интерактивная лаборатория рейтинговых формул")

st.subheader(current_def.name)


@st.fragment
def formula_panel(formula_id: str):
    """
    Fragment reruns independently from the rest of the page.
    Clicking the formula component therefore does not navigate, change the URL,
    jump to the top, or recalculate the rating table below.
    """
    definition = FORMULAS[formula_id]
    selected_before = st.session_state.get("selected_formula_token")

    clicked = formula_picker(
        formula_id=formula_id,
        selected=selected_before,
        eu_weight=get_param(formula_id, "eu_weight") if formula_id == "legacy" else None,
        t5_weight=get_param(formula_id, "t5_weight") if formula_id == "legacy" else None,
        key=f"formula-picker::{formula_id}",
    )

    if clicked and clicked in help_data:
        st.session_state["selected_formula_token"] = clicked

    selected = st.session_state.get("selected_formula_token")
    if not selected or selected not in help_data:
        return

    item = help_data[selected]
    with st.container(border=True):
        info_col, control_col = st.columns([2.3, 1])

        with info_col:
            st.markdown(f"#### {item['title']}")
            st.write(item["body"])
            st.caption("Источник: " + item["source"])

        with control_col:
            param_key = item.get("parameter")
            spec = get_spec(formula_id, param_key) if param_key else None

            if not spec:
                st.caption("У этого обозначения нет отдельного настраиваемого коэффициента.")
                return

            st.markdown("**Параметр эксперимента**")

            old_value = get_param(formula_id, spec.key)
            new_value = render_control(formula_id, spec, "formula_card")
            default = definition.defaults()[spec.key]

            st.caption(f"Default: {default}")

            if st.button(
                "Сбросить параметр",
                key=f"reset::{formula_id}::{spec.key}",
            ):
                set_param(formula_id, spec.key, default)
                st.rerun(scope="fragment")

            # A parameter change must recalculate the full rating table.
            # Clicking a symbol alone does not.
            if new_value != old_value:
                st.rerun()


formula_panel(current_formula_id)

# Recalculate after possible main-card edit.
current_params = ensure_formula_state(current_formula_id)
reference_params = FORMULAS[reference_formula_id].defaults()
current_result = FORMULAS[current_formula_id].build(current_params).calculate(players, results, evaluation_date)
reference_result = FORMULAS[reference_formula_id].build(reference_params).calculate(players, results, evaluation_date)
comp = compare_rankings(current_result, reference_result)

st.divider()

# ---------------- rating table ----------------
head_a, head_b, head_c = st.columns([2, 1, 1])
with head_a:
    st.subheader("Рейтинговая таблица")
with head_b:
    st.caption("Текущая")
    st.write(FORMULAS[current_formula_id].name)
with head_c:
    st.caption("Эталон")
    st.write(FORMULAS[reference_formula_id].name + " default")

cols = ["rank_current", "player_name", "rating_current", "rating_ref", "delta_rating", "delta_rank"]
labels = {
    "rank_current": "#", "player_name": "Игрок", "rating_current": "Rating",
    "rating_ref": "Эталон", "delta_rating": "Δ Rating", "delta_rank": "Δ место",
}
if current_formula_id == "legacy":
    cols[2:2] = ["level_current", "eu_current", "t5_current"]
    labels.update({"level_current": "Уровень", "eu_current": "EU", "t5_current": "T5"})
else:
    cols[2:2] = ["mu_current", "sigma_current"]
    labels.update({"mu_current": "μ", "sigma_current": "σ"})

view = comp[cols].rename(columns=labels)
st.dataframe(
    view,
    width="stretch",
    hide_index=True,
    column_config={
        "Rating": st.column_config.NumberColumn(format="%.2f"),
        "Эталон": st.column_config.NumberColumn(format="%.2f"),
        "Δ Rating": st.column_config.NumberColumn(format="%+.2f"),
        "Δ место": st.column_config.NumberColumn(format="%+d"),
        "EU": st.column_config.NumberColumn(format="%.0f"),
        "T5": st.column_config.NumberColumn(format="%.1f"),
        "μ": st.column_config.NumberColumn(format="%.2f"),
        "σ": st.column_config.NumberColumn(format="%.2f"),
    },
)

st.divider()

# ---------------- delta / impact ----------------
st.subheader("Изменения относительно эталона")
valid = comp.dropna(subset=["rank_current", "rank_ref", "rating_current", "rating_ref"]).copy()
rank_corr = valid["rank_current"].corr(valid["rank_ref"], method="pearson") if len(valid) > 1 else float("nan")
changed = int((valid["delta_rank"] != 0).sum())
mean_abs = valid["delta_rating"].abs().mean() if len(valid) else float("nan")
max_up = valid["delta_rating"].max() if len(valid) else float("nan")
max_down = valid["delta_rating"].min() if len(valid) else float("nan")
top10_current = set(valid.nsmallest(10, "rank_current")["player_id"])
top10_ref = set(valid.nsmallest(10, "rank_ref")["player_id"])
top10_changed = len(top10_current.symmetric_difference(top10_ref)) // 2

m1, m2, m3, m4, m5 = st.columns(5)
m1.metric("Изменили место", changed)
m2.metric("Среднее |Δ Rating|", f"{mean_abs:.2f}")
m3.metric("Макс. рост", f"{max_up:+.2f}")
m4.metric("Макс. падение", f"{max_down:+.2f}")
m5.metric("Корреляция рангов", f"{rank_corr:.3f}" if not math.isnan(rank_corr) else "—")
st.caption(f"Изменений состава Top-10: {top10_changed}")

left, right = st.columns(2)
with left:
    st.markdown("**Наибольший рост**")
    up = valid.nlargest(5, "delta_rating")[["player_name", "delta_rating", "delta_rank"]]
    st.dataframe(up.rename(columns={"player_name": "Игрок", "delta_rating": "Δ Rating", "delta_rank": "Δ место"}), hide_index=True, width="stretch")
with right:
    st.markdown("**Наибольшее падение**")
    down = valid.nsmallest(5, "delta_rating")[["player_name", "delta_rating", "delta_rank"]]
    st.dataframe(down.rename(columns={"player_name": "Игрок", "delta_rating": "Δ Rating", "delta_rank": "Δ место"}), hide_index=True, width="stretch")

with st.expander("Подробнее об игроке"):
    selected_player = st.selectbox("Игрок", current_result.ranking["player_name"].tolist())
    pid = current_result.ranking.loc[current_result.ranking["player_name"] == selected_player, "player_id"].iloc[0]
    if current_formula_id == "legacy" and not current_result.tournament_rows.empty:
        detail = current_result.tournament_rows[current_result.tournament_rows["player_id"].astype(str) == str(pid)]
        st.dataframe(detail.sort_values("tournament_date"), width="stretch", hide_index=True)
    if not current_result.state_history.empty:
        st.caption("История состояния")
        hist = current_result.state_history[current_result.state_history["player_id"].astype(str) == str(pid)]
        st.dataframe(hist.sort_values("date"), width="stretch", hide_index=True)
