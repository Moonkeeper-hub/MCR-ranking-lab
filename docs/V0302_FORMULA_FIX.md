# v0.30.2 — TrueSkill formula rendering hotfix

Исправлен KaTeX-рендер итогового TrueSkill update. В v0.30.1 управляющая последовательность `\right)` была повреждена при генерации исходника и попадала в DOM как текст. Математика движка TrueSkill не изменялась.
