# Переход с Streamlit на статический frontend

## Первый переход

1. Сохранить текущую Streamlit-версию в git tag/ветке.
2. Собрать frontend:

```bash
npm install
npm run build
```

3. Создать каталог статического сайта:

```bash
sudo mkdir -p /opt/moonkeeper-ranking
sudo rm -rf /opt/moonkeeper-ranking/*
sudo cp -r dist/* /opt/moonkeeper-ranking/
```

4. Смонтировать `/opt/moonkeeper-ranking` в Caddy container как read-only каталог, аналогично `/opt/moonkeeper-site`.
5. Заменить `reverse_proxy mcr-ranking-lab:8501` на `root + file_server` из `Caddyfile.example`.
6. Проверить конфигурацию Caddy и reload.
7. После проверки остановить старый `mcr-ranking-lab` Streamlit container и убрать порт 8501.

## Обычное обновление после перехода

```bash
cd /opt/MCR-ranking-lab
git pull
npm install
npm run build
sudo rm -rf /opt/moonkeeper-ranking/*
sudo cp -r dist/* /opt/moonkeeper-ranking/
```

Caddy restart для обычного обновления frontend не нужен.
