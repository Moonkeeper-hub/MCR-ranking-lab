# Планируемая схема БД / API

```mermaid
erDiagram
    PLAYERS ||--o{ TOURNAMENT_RESULTS : plays
    TOURNAMENTS ||--o{ TOURNAMENT_RESULTS : contains

    PLAYERS {
        text player_id PK
        text player_name
        int initial_eu
        smallint initial_marks
        date initial_dan_date
    }

    TOURNAMENTS {
        text tournament_id PK
        text tournament_name
        date tournament_date
        int tournament_order
        int participants
        int sessions
        boolean is_world_europe
        text tournament_tier
        text location
    }

    TOURNAMENT_RESULTS {
        text tournament_id PK,FK
        text player_id PK,FK
        int place
    }

    REF_LEGACY_LEVEL {
        int eu PK
        text level_kind
        int ordinal
        text label
    }

    REF_LEGACY_KT_PARTICIPANTS {
        int participants PK
        decimal kt_component
    }

    REF_LEGACY_AGE_WEIGHT {
        int min_months PK
        int max_months
        decimal weight
    }

    REF_LEGACY_TOURNAMENT_STATUS {
        text status_code PK
        decimal kt_bonus
    }

    REF_LEGACY_CONSTANT {
        text constant_code PK
        decimal numeric_value
        text description
    }
```

## Что изменяемое, а что нет

`players`, `tournaments`, `tournament_results` — фактические данные.

`ref_legacy_*` — нормативные справочники Legacy. Они не должны редактироваться
через UI/API. В `db/schema.sql` UPDATE/DELETE для них запрещены триггерами.
Изменение нормативного справочника означает выпуск новой версии формулы,
а не изменение пользовательского пресета.

Экспериментальные коэффициенты лаборатории не перезаписывают эти таблицы.
