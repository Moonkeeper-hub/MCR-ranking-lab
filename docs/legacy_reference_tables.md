# Неизменяемые справочники Legacy

Канонические значения в коде находятся в `rating_engine/legacy_tables.py`.

- `LEGACY_LEVELS` — кю/дан ↔ EU.
- `KT_PARTICIPANTS` — KT_ЧУТ по числу участников.
- `LEGACY_AGE_WEIGHTS` — VT по возрасту турнира.
- `TOURNAMENT_STATUS_BONUS` — обычный турнир / ЧЕ-ЧМ.
- `LEGACY_FIXED_DEFAULTS` — фиксированные числовые правила Legacy.

Для будущего PostgreSQL эти же данные подготовлены в:
- `db/schema.sql`
- `db/reference_data.sql`

В Python словари обёрнуты в `MappingProxyType`, а записи уровней/возрастов —
в `frozen=True` dataclass. Это защищает их от случайной мутации в runtime.
