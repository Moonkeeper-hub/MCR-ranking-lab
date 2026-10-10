# Формат данных

Mahjong Rating Lab использует два основных CSV-файла:

```text
players.csv
results.csv
```

Формат общий для всех рейтинговых движков, но каждая методика самостоятельно валидирует необходимые ей поля и турниры.

## players.csv

Базовые поля:

```text
player_id,
player_name,
initial_eu,
initial_marks,
initial_dan_date,
include_in_rating
```

### player_id

Уникальный идентификатор игрока внутри dataset.

### player_name

Отображаемое имя игрока.

### initial_eu

Начальное состояние EU до первого турнира загружаемой истории.

Для нового MCR-игрока:

```text
initial_eu = 0
```

### initial_marks

Начальные плюсы или минусы MCR.

```text
0  — без отметок
1  — плюс
-1 — минус
```

### initial_dan_date

Дата последнего подтверждения данового EU до начала загружаемой истории.

Используется MCR-движками для моделирования временного понижения.

### include_in_rating

Если:

```text
false
```

игрок участвует в турнирах и расчётах, но не отображается во внутренней итоговой рейтинговой таблице.

Это используется, например, для внешних участников.

## results.csv

Основные поля:

```text
tournament_id,
tournament_name,
tournament_date,
tournament_order,
player_id,
place,
participants,
sessions,
is_status_tournament,
is_substitute
```

### tournament_id

Идентификатор турнира.

### tournament_name

Отображаемое название.

### tournament_date

Дата рейтингового события.

### tournament_order

Порядок обработки турниров при совпадении даты.

### player_id

Ссылка на игрока из `players.csv`.

### place

Итоговое место.

### participants

Число участников / ЧУТ.

### sessions

Число сессий / ханчанов.

### is_status_tournament

Признак статусного турнира для MCR.

### is_substitute

Признак технического игрока замены.

Для обратной совместимости старое поле `is_world_europe` может временно приниматься как alias для `is_status_tournament`.

## Дополнительные поля

Дополнительные колонки допустимы.

Mock generator, импорт EMA и исследовательские datasets могут хранить дополнительные метаданные, которые игнорируются движком, если конкретной методике они не нужны.

## Simulation-only поля

Mock generator может добавлять в `players.csv`:

```text
latent_elo,
activity,
external_activity,
consistency,
skill_drift_per_year,
active_from,
active_to,
country
```

Они используются только при генерации synthetic history и не являются известной рейтинговым методам истинной силой игрока.
