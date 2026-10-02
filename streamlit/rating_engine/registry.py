from .definitions import FORMULAS


def get_definition(formula_id: str):
    return FORMULAS[formula_id]
