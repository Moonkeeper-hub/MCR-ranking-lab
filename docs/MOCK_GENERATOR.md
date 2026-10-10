# Mock generator

Mock generator создаёт воспроизводимые synthetic datasets для тестирования рейтинговых систем.

Генератор разделён на три части:

```text
Players
Tournament templates
History generation
```

## Игроки

Player template может задавать:

- имя;
- `latent_elo`;
- activity;
- external activity;
- consistency;
- `skill_drift_per_year`;
- `active_from`;
- `active_to`;
- `include_in_rating`;
- страну / профиль;
- initial MCR state;
- multiplier.

### latent_elo

`latent_elo` — скрытая сила игрока, известная только генератору.

Рейтинговые движки не получают её как входной параметр.

### Activity

`activity` задаёт вероятность участия во внутренних турнирах.

`external_activity` используется для внешних событий.

### Consistency

Consistency управляет случайным разбросом performance относительно скрытой силы.

### Skill drift

Скрытая сила может изменяться со временем:

```text
effective_elo =
latent_elo +
skill_drift_per_year × years_since_active_from
```

### Active period

Игрок участвует только в пределах:

```text
active_from
active_to
```

После завершения active period он остаётся в dataset и историческом рейтинге, но перестаёт участвовать в новых турнирах.

### include_in_rating

`false` удобно использовать для внешних игроков.

Они участвуют в турнирах и влияют на расчёты, но не входят во внутреннюю итоговую таблицу.

## Tournament templates

Шаблон турнира может задавать:

- название;
- target size;
- minimum size;
- число туров;
- тип рассадки;
- internal / external;
- статус;
- рейтинговую квоту;
- qualification method;
- substitutes;
- substitute strength policy;
- frequency per year;
- fixed months;
- skill influence;
- tournament randomness;
- multiplier.

## Рассадка

Доступны:

### Random

Столы каждого тура формируются случайно.

### Swiss

Игроки группируются по текущему tournament standing.

### Seeded → Swiss

Первый тур использует исходный посев по synthetic strength, следующие — Swiss.

## Рейтинговая квота

Для статусных и внешних турниров можно резервировать часть мест через выбранный рейтинг.

Доступны, в частности:

```text
Neutral mock rating
Project MCR
Legacy MCR observed
RR
TrueSkill Tournament
Elo-PL
```

Конкретный набор зависит от текущей версии приложения.

## Neutral mock rating

Neutral mock rating используется, когда отбор не должен зависеть от одной исследуемой рейтинговой системы.

Для результата:

```text
result_score =
1000 × (N - place) / (N - 1)
```

Обновление:

```text
MockRating_new =
(1 - α) × MockRating_old
+ α × result_score
```

Default:

```text
α = 0.25
```

## External tournaments

Внешний турнир формирует состав с учётом:

- substitutes;
- рейтинговой квоты;
- внутренних и внешних игроков;
- `include_in_rating`.

Внутренние игроки не должны автоматически заполнять весь внешний турнир только из-за высокой общей activity.

## Генерация истории

Глобально задаются:

```text
Seed
History start
History end
```

При одинаковых:

```text
seed
player templates
tournament templates
period
generator settings
```

должен создаваться одинаковый dataset.

## Pipeline

```text
Player templates
    ↓
expand players
    ↓
Tournament templates
    ↓
expand calendar
    ↓
eligible players
    ↓
reserve substitutes
    ↓
rating quota
    ↓
fill remaining seats
    ↓
simulate rounds
    ↓
final places
```

## Симуляция результата

Для каждого игрока рассчитывается текущий synthetic skill.

Performance зависит от:

- effective ELO;
- consistency;
- tournament skill influence;
- tournament randomness.

По результатам каждого стола начисляются tournament points:

```text
1 место → 4
2 место → 2
3 место → 1
4 место → 0
```

Итоговый `place` определяется по:

1. сумме tournament points;
2. суммарному raw performance;
3. среднему месту за столами;
4. deterministic seeded tie-break.

## Результат генерации

Генератор создаёт:

```text
players.csv
results.csv
manifest.json
```

`manifest.json` хранит параметры воспроизводимости:

- seed;
- диапазон дат;
- player templates;
- tournament templates;
- глобальные настройки;
- число созданных и отменённых турниров;
- число substitutes.
