# MCR Rating Lab v0.20

Клиентская версия лаборатории рейтингов. Расчёт Legacy выполняется полностью в браузере пользователя: загруженные CSV не отправляются на сервер.

## Что перенесено из Python v0.10

- Legacy: NR, KT, VT, NR×KT×VT, T5 и итоговый Rating.
- EU state machine: кю/даны, успехи/неуспехи, подтверждение D2+, Double Strike.
- Канонические таблицы Legacy и экспериментальные копии KT по числу участников и VT.
- Сравнение текущего расчёта с неизменяемым Legacy default.
- Загрузка `players.csv` и `results.csv` локально в браузере.
- Светлая/тёмная тема без фиксированных чёрных цветов.

TrueSkill пока не перенесён: v0.20 специально фиксирует сначала точный перенос Legacy. Архитектура `src/engine` допускает добавление других движков отдельно.

## Локальный запуск

```bash
npm install
npm run dev
```

Сборка:

```bash
npm run build
```

Готовый статический сайт появится в `dist/`.

## Деплой

```bash
cd /opt/MCR-ranking-lab
git pull
npm install
npm run build
sudo rm -rf /opt/moonkeeper-ranking/*
sudo cp -r dist/* /opt/moonkeeper-ranking/
```

Caddy раздаёт `/opt/moonkeeper-ranking` как обычные статические файлы. Python, Streamlit и порт 8501 для этой версии не нужны.

## CSV

`players.csv`:

```text
player_id,player_name,initial_eu,initial_marks,initial_dan_date
```

`results.csv`:

```text
tournament_id,tournament_name,tournament_date,tournament_order,player_id,place,participants,sessions,is_world_europe
```

Дополнительные колонки допустимы и игнорируются движком.

## Проверка переноса

Legacy default сопоставлен с Python v0.10 на исходном 12-player fixture: `current_eu`, `t5`, `rating` и `rank` совпали для всех игроков, максимальная ошибка 0. Подробности: `docs/PARITY.md`.
