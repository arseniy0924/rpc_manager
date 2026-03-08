# Project Context: Llama.cpp RPC Manager & Orchestrator

## 📌 Описание проекта
Веб-интерфейс (Дашборд) для управления кластером нейросетей на базе `llama.cpp`. Система состоит из Главного сервера (Orchestrator) и удаленных вычислительных узлов (RPC Nodes). Позволяет распределять слои тяжелых LLM (например, Qwen 35B) по локальным и удаленным видеокартам (Vulkan / CUDA).

## 🛠 Технологический стек и Архитектура
- **Backend:** Python 3, Flask, Flask-SocketIO (для телеметрии реального времени).
- **Frontend:** HTML, TailwindCSS, Vanilla JavaScript (ES6 Modules).
- **Core Engine:** `llama-server.exe` (llama.cpp) с поддержкой RPC, CUDA и Vulkan.
- **Discovery:** Главный сервер вещает через mDNS (`_rpc-manager._tcp.local.`), а агенты автоматически его находят.
- **Telemetry:** Агенты шлют HTTP POST (`/api/heartbeat`), а сервер пушит данные в UI через WebSocket (`socket.emit`).

## 📂 Ключевые файлы

### Backend (Python)
- `app.py`: Главный сервер Flask. Обрабатывает REST API и WebSocket соединения.
- `orchestrator.py`: Управляет процессом `llama-server.exe`. Формирует команды запуска, применяет изоляцию GPU через переменные окружения (`CUDA_VISIBLE_DEVICES`, `GGML_VK_VISIBLE_DEVICES`), читает логи процесса.
- `services/discovery.py`: mDNS/Zeroconf.
- `services/github_updater.py`: Логика скачивания релизов `llama.cpp`.

### Frontend (JavaScript - `server/static/js/`)
- `main.js`: Точка входа. Управляет сокетами, обновляет глобальные счетчики ресурсов кластера (`clusterStats`), содержит "сторожевой таймер" (Watchdog) для отключения зависших нод.
- `orchestrator.js`: Логика Главного сервера. Выбор моделей, скачивание версий бинарников (без дубликатов через `Set`), сохранение пресетов, сбор локальных GPU (`.local-gpu-toggle`) и запуск кластера.
- `ui.js`: Отрисовка карточек удаленных нод. Кнопки Start/Stop RPC, тумблеры нод, сбор удаленных GPU (`.gpu-toggle`), функция безопасного копирования в буфер.
- `api.js`: Все `fetch` запросы к бэкенду.

## ⚠️ Критические правила проекта (НЕ ЛОМАТЬ!)

При внесении изменений строго учитывайте следующие исторические фиксы:

1. **Разница в названиях переменных телеметрии (Fallback parsing):**
   Бэкенд сервера и RPC-ноды присылают ключи ресурсов с разными суффиксами. Обязательно использовать `||` при парсинге:
   - RAM: `parseFloat(data.ram_used || data.ram_used_gb || 0)`
   - GPU VRAM: `parseFloat(gpu.vram_used_gb || gpu.used_gb || 0)`
   - GPU Temp: `(gpu.temp || gpu.temp_c || 0)`

2. **Сбор галочек GPU на Frontend:**
   - **Локальные карты** (Главный сервер) имеют класс `.local-gpu-toggle` (и атрибут `data-gpu-index`). Собираются в `orchestrator.js`.
   - **Удаленные карты** (Ноды) имеют класс `.gpu-toggle`. Собираются строго внутри контейнера своей карточки `#node-${nodeId}`. Не смешивать их!

3. **Изоляция видеокарт (GPU Isolation в `orchestrator.py`):**
   - Фронтенд присылает массив `selected_gpus` (например, `[0, 1, 2]`).
   - Бэкенд ОБЯЗАН фильтровать дубликаты через `set()` и обрабатывать пустой список (ставить `CUDA_VISIBLE_DEVICES="-1"`).
   - Для **Vulkan** используется жесткий маппинг индексов: `{0:0, 1:2, 2:1}` (специфика оборудования).

4. **Сторожевой таймер (Watchdog):**
   В `main.js` внутри `socket.on('node_updated')` работает таймер `nodeWatchdogs` на 15 секунд. Если от ноды нет пинга, она принудительно переводится в статус `OFFLINE`, её визуальные ресурсы обнуляются, а память вычитается из глобального `clusterStats`.

5. **Работа с буфером обмена (Clipboard API):**
   Поскольку приложение собирается в `.exe` и открывается по локальному IP (без HTTPS), стандартный `navigator.clipboard` блокируется. В `ui.js` реализована функция `copyToClipboard` с фолбэком на создание невидимого `<textarea>` и `document.execCommand('copy')`. Использовать только её.