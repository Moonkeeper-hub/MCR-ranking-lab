# MCR Rating Lab v8

Компоновка: интерактивная формула сверху → рейтинговая таблица → дельты → детали игрока. Слева — быстрые настройки и переключение формул.

## Запуск

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
streamlit run app.py
```

## Что изменилось

- Добавлен `FormulaDefinition`: интерфейс больше не зашит под Legacy.
- Формула всегда находится наверху страницы.
- Переменные формулы кликабельны; клик открывает описание, источник и связанный контрол.
- Sidebar и карточка формулы используют одно состояние параметров.
- Ниже формулы показывается текущий рейтинг и эталон.
- Ниже таблицы — дельты: изменение рейтинга, мест, корреляция рангов, Top-10, gainers/losers.
- Добавлен экспериментальный TrueSkill для проверки архитектуры сравнения формул.
- Детали конкретного игрока спрятаны в раскрывающийся блок.

## Формулы

### Legacy
Реконструкция MCR Legacy с EU, кю/данами, +/- и Double Strike.

### TrueSkill (эксперимент)
Каждый турнир трактуется как одно многопользовательское ранжированное событие. Для отображаемого score используется `μ - kσ`. Это не часть Legacy и не утверждённый рейтинг MCR; ветка нужна для сравнительных экспериментов.

## Как добавить новую формулу

1. Создать engine с методом `calculate(players, results, evaluation_date)`.
2. Создать dataclass конфигурации.
3. Добавить `FormulaDefinition` в `rating_engine/definitions.py`.
4. Описать параметры через `ParameterSpec`.
5. Добавить `formula_blocks` с кликабельными токенами.

После этого sidebar и верхняя формула строятся без отдельной ветки `if formula == ...`.


## v4
- Legacy formula is rendered in source/article notation as one continuous mathematical block.
- Variables are inline clickable text links, not UI buttons.
- Added Docker/Caddy deployment files for ranking.moonkeeper.ru.


## v5 — клики по формуле без навигации страницы

Формула вынесена в локальный двусторонний Streamlit component.

- Элементы формулы больше не являются HTML-ссылками.
- URL не меняется (`?token=...` удалён).
- Клик отправляет выбранный токен в Streamlit через component API.
- Панель формулы работает внутри `@st.fragment`, поэтому обычный клик
  перезапускает только верхний fragment, а не всю страницу.
- Изменение коэффициента по-прежнему делает полный rerun, потому что необходимо
  пересчитать рейтинг и дельты ниже.


## v6 — Streamlit 2026 compatibility and component height fix

- Replaced deprecated `use_container_width=True/False` with `width="stretch"/"content"`.
- Fixed formula component iframe height feedback loop.
- Formula iframe now measures only the actual rendered `#root` content.
- Added `ResizeObserver` for stable height updates without runaway page growth.


## v7 — схема БД и неизменяемые Legacy-справочники

- `docs/database.md` — ER-диаграмма БД в Mermaid.
- `rating_engine/legacy_tables.py` — канонические неизменяемые таблицы Legacy.
- `db/schema.sql` — черновая PostgreSQL-схема.
- `db/reference_data.sql` — seed нормативных справочников.
- `legacy.py` и `evolution.py` используют единый источник табличных значений.


## v8 — исправление Legacy tables и связанные веса EU/T5

- Исправлен `NameError: KT_PARTICIPANTS`: `legacy.py` теперь явно импортирует
  канонический справочник из `legacy_tables.py`.
- `eu_weight + t5_weight` теперь является жёстким инвариантом Legacy и всегда = 1.
- Два ползунка связаны: движение одного автоматически двигает второй.
- Коэффициенты в формуле сверху показывают текущие значения и кликабельны.
- `LegacyConfig` валидирует сумму весов при создании.
