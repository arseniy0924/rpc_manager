import { state } from './state.js';
import {
    saveConfig,
    fetchModels,
    updateServerBinary,
    saveOrchestratorConfig,
    saveOrchestratorPort,
    startOrchestratorProcess,
    stopOrchestratorProcess,
    getOrchestratorStatus,
    getServerUpdateStatus,
    fetchServerVersions,
    fetchPresets,
    savePreset,
    loadLastSelectedModel,
    saveLastSelectedModel,
    startRpc, // <-- ДОБАВИТЬ ЭТО
    stopRpc   // <-- И ЭТО
} from './api.js';
import { copyToClipboard } from './ui.js';

export async function saveConfigAndScan() {
    const pathInput = document.getElementById('models-path-input');
    const newPath = pathInput.value;

    if (!newPath) {
        alert("Please enter a valid path.");
        return;
    }

    const btn = document.getElementById('scan-models-btn');
    const originalText = btn.textContent;
    btn.textContent = "Scanning...";
    btn.disabled = true;

    const success = await saveConfig(newPath);
    if (success) {
        await populateModelsSelect();
    } else {
        alert("Failed to save configuration.");
    }

    btn.textContent = originalText;
    btn.disabled = false;
}

export async function populateModelsSelect() {
    const select = document.getElementById('main-model-select');
    select.innerHTML = '<option>Scanning...</option>';
    select.disabled = true;

    const data = await fetchModels();
    select.innerHTML = ''; // Clear

    if (data.models && data.models.length > 0) {
        data.models.sort((a, b) => a.name.localeCompare(b.name));

        const defaultOption = document.createElement('option');
        defaultOption.text = "Select a model...";
        defaultOption.value = "";
        defaultOption.disabled = true;
        defaultOption.selected = true;
        select.appendChild(defaultOption);

        data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.absolute_path;
            option.text = `[${model.size_gb} GB] ${model.relative_path}`;
            select.appendChild(option);
        });

        // Restore last selected model
        const lastModel = await loadLastSelectedModel();
        if (lastModel) {
            // Check if option exists
            const optionExists = Array.from(select.options).some(opt => opt.value === lastModel);
            if (optionExists) {
                select.value = lastModel;
                // Load presets for restored model
                await loadPresetsForModel(lastModel);
            }
        }

        // Add event listener for model change
        select.onchange = async () => {
            await saveLastSelectedModel(select.value);
            await loadPresetsForModel(select.value);
        };

    } else {
        const option = document.createElement('option');
        option.text = "No .gguf models found in directory";
        select.appendChild(option);
    }
    select.disabled = false;
}

export async function loadPresetsForModel(modelPath, targetName = null) {
    if (!modelPath) return;

    const presetSelect = document.getElementById('preset-select');
    presetSelect.innerHTML = '<option value="Default">Default</option>';

    const data = await fetchPresets(modelPath);
    const presets = data.presets || {};

    for (const presetName in presets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.text = presetName;
        state.currentModelPresets = presets;
        presetSelect.appendChild(option);
    }

    // Reset inputs to default
    applyPresetSettings("Default");

    // Restore selection
    if (targetName && presetSelect.querySelector(`option[value="${targetName}"]`)) {
        presetSelect.value = targetName;
        // Trigger change event to apply settings
        presetSelect.dispatchEvent(new Event('change'));
    } else {
        // Try to restore from localStorage
        const savedPreset = localStorage.getItem('lastSelectedPreset');
        if (savedPreset && presetSelect.querySelector(`option[value="${savedPreset}"]`)) {
            presetSelect.value = savedPreset;
            presetSelect.dispatchEvent(new Event('change'));
        }
    }

    presetSelect.onchange = () => {
        // Save selection to localStorage
        localStorage.setItem('lastSelectedPreset', presetSelect.value);
        applyPresetSettings(presetSelect.value);
    };
}

function applyPresetSettings(presetName) {
    const settings = (state.currentModelPresets && state.currentModelPresets[presetName]) || {};

    // Defaults
    document.getElementById('param-c').value = settings.c || 32768;
    document.getElementById('param-ngl').value = settings.ngl || 99;
    document.getElementById('param-cache-k').value = settings.cache_type_k || "f16";
    document.getElementById('param-cache-v').value = settings.cache_type_v || "f16";
    document.getElementById('param-fa').checked = settings.flash_attn !== false; // Default true
    document.getElementById('param-mmap').checked = settings.no_mmap !== false; // Default true
    document.getElementById('param-disable-local').checked = settings.disable_local_gpu === true; // Default false
    document.getElementById('param-fit').value = settings.fit || "";
    document.getElementById('param-custom').value = settings.custom_args || "";
}

export async function saveCurrentPreset() {
    const modelPath = document.getElementById('main-model-select').value;
    const presetNameInput = document.getElementById('new-preset-name');
    const targetName = presetNameInput.value;

    if (!modelPath) {
        alert("Please select a model first.");
        return;
    }
    if (!targetName) {
        alert("Please enter a preset name.");
        return;
    }

    const settings = {
        c: parseInt(document.getElementById('param-c').value),
        ngl: parseInt(document.getElementById('param-ngl').value),
        cache_type_k: document.getElementById('param-cache-k').value,
        cache_type_v: document.getElementById('param-cache-v').value,
        flash_attn: document.getElementById('param-fa').checked,
        no_mmap: document.getElementById('param-mmap').checked,
        disable_local_gpu: document.getElementById('param-disable-local').checked,
        fit: document.getElementById('param-fit').value,
        custom_args: document.getElementById('param-custom').value
    };

    const success = await savePreset(modelPath, targetName, settings);
    if (success) {
        alert("Preset saved!");
        // Refresh presets list and restore selection
        await loadPresetsForModel(modelPath, targetName);
    } else {
        alert("Failed to save preset.");
    }
}

export async function populateServerSelect() {
    const select = document.getElementById('main-version-select');
    if (!select) return;

    // 1. ЗАПОМИНАЕМ ТЕКУЩИЙ ВЫБОР (перед обновлением списка)
    let currentTag = null;
    if (select.value && select.value.trim().startsWith('{')) {
        try {
            currentTag = JSON.parse(select.value).version_tag;
        } catch (e) {}
    }

    // 2. ЗАПРОСЫ ДАННЫХ
    const [releasesData, serverVersionsData] = await Promise.all([
        fetch('/api/releases').then(r => r.ok ? r.json() : {}),
        fetch('/api/server/versions').then(r => r.ok ? r.json() : { installed: [] })
    ]);

    const combinedVersions = [];
    const serverInstalled = serverVersionsData.installed || [];
    const addedTags = new Set(); // Защита от дубликатов

    // 3. ДОБАВЛЯЕМ УСТАНОВЛЕННЫЕ ВЕРСИИ (они в приоритете)
    serverInstalled.forEach(tag => {
        if (!addedTags.has(tag)) {
            combinedVersions.push({
                version_tag: tag,
                name: releasesData[tag] ? `Llama ${tag}` : `Local: ${tag}`,
                is_installed: true,
                // Ищем метаданные в ответах GitHub, если они там есть
                url: releasesData[tag]?.backends?.[tag.split('_').pop()]?.url || "",
                filename: releasesData[tag]?.backends?.[tag.split('_').pop()]?.filename || ""
            });
            addedTags.add(tag);
        }
    });

    // 4. ДОБАВЛЯЕМ ОСТАЛЬНЫЕ ВЕРСИИ ИЗ GITHUB
    for (const releaseTag in releasesData) {
        const release = releasesData[releaseTag];
        for (const backendKey in release.backends) {
            const versionTag = `${release.tag_name}_${backendKey}`;

            if (addedTags.has(versionTag)) continue; // Пропускаем, если уже добавлена

            const backend = release.backends[backendKey];
            combinedVersions.push({
                version_tag: versionTag,
                name: `Llama ${release.tag_name} (${backendKey})`,
                url: backend.url,
                filename: backend.filename,
                extra_assets: backend.extra_assets || [],
                is_installed: false
            });
            addedTags.add(versionTag);
        }
    }

    // 5. ОТРИСОВКА <OPTION>
    select.innerHTML = '<option value="" disabled>Select Version...</option>';
    combinedVersions.forEach(version => {
        const option = document.createElement('option');
        option.value = JSON.stringify({
            url: version.url,
            filename: version.filename,
            version_tag: version.version_tag,
            extra_assets: version.extra_assets || []
        });

        option.textContent = version.is_installed ? `✅ [INSTALLED] ${version.name}` : version.name;
        select.appendChild(option);
    });

    // 6. УМНЫЙ АВТОВЫБОР (чтобы Vulkan не слетал на CUDA)
    // Приоритет: 1. Текущий выбор -> 2. localStorage -> 3. Config -> 4. Последняя установленная
    let targetTag = currentTag || localStorage.getItem('lastSelectedOrchestratorTag');

    if (!targetTag && state.serverConfig && state.serverConfig.orchestrator_version) {
        targetTag = state.serverConfig.orchestrator_version;
    }

    if (!targetTag && serverInstalled.length > 0) {
        const installedSorted = serverInstalled
            .map(v => {
                const match = v.match(/^b(\d+)/);
                return { tag: v, num: match ? parseInt(match[1], 10) : 0 };
            })
            .sort((a, b) => b.num - a.num);
        targetTag = installedSorted[0].tag;
    }

    if (targetTag) {
        for (const option of select.options) {
            try {
                const val = JSON.parse(option.value);
                if (val.version_tag === targetTag) {
                    select.value = option.value;
                    break;
                }
            } catch (e) {}
        }
    }

    // СОХРАНЯЕМ ВЫБОР ПРИ РУЧНОМ ИЗМЕНЕНИИ
    select.onchange = () => {
        try {
            const val = JSON.parse(select.value);
            localStorage.setItem('lastSelectedOrchestratorTag', val.version_tag);
        } catch(e) {}
    };
}

export async function installServerVersion() {
    const select = document.getElementById('main-version-select');
    if (!select || !select.value) {
        alert("Please select a version first.");
        return;
    }

    const selectedData = JSON.parse(select.value);

    const logDiv = document.getElementById('server-download-log');
    const logText = document.getElementById('server-download-text');
    logDiv.classList.remove('hidden');
    logText.classList.remove('text-red-500');
    logText.textContent = "Starting update request...";

    try {
        // 1. Отправляем запрос на сервер со всеми данными (включая DLL)
        const response = await fetch('/api/server/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(selectedData)
        });

        if (response.ok) {
            logText.textContent = "Download started on server. Connecting to logs...";

            // 2. Запускаем опрос статуса загрузки
            pollServerUpdateStatus();

            // 3. Сохраняем настройки (оборачиваем в try/catch, чтобы интерфейс не ломался при ошибке)
            try {
                const { saveOrchestratorConfig, saveOrchestratorPort } = await import('./api.js');
                await saveOrchestratorConfig(selectedData.version_tag);

                const portInput = document.getElementById('orchestrator-port-input');
                if (portInput && portInput.value) {
                    await saveOrchestratorPort(parseInt(portInput.value));
                }
            } catch (configErr) {
                console.warn("Could not save config, but download continues:", configErr);
            }

        } else {
            const errData = await response.json();
            logText.textContent = "Failed to start update: " + (errData.error || "Unknown error");
            logText.classList.add("text-red-500");
        }
    } catch (error) {
        console.error("Error starting server update:", error);
        logText.textContent = "JS Error: " + error.message; // Теперь покажет реальную ошибку, а не фейковую сеть
        logText.classList.add("text-red-500");
    }
}

// Новая функция для красивого вывода прогресса в консоль интерфейса
let serverUpdateInterval = null;
function pollServerUpdateStatus() { // Убедись, что тут стоит export (если потребуется)
    if (serverUpdateInterval) clearInterval(serverUpdateInterval);

    const logText = document.getElementById('server-download-text');

    serverUpdateInterval = setInterval(async () => {
        try {
            const response = await fetch('/api/server/status');
            const data = await response.json();

            if (data.message) {
                logText.textContent = data.message;
            }

            // Останавливаем таймер, когда загрузка завершена
            if (data.status === "IDLE") {
                clearInterval(serverUpdateInterval);
                if (data.message === "") {
                    logText.textContent = "Update process completed.";
                }

                // --- ДОБАВЛЕНО: АВТО-ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ---
                // Запрашиваем с сервера новый список установленных версий
                // и заставляем выпадающий список перерисоваться (появится галочка)
                await fetchServerVersions();
                populateServerSelect();
                // ---------------------------------------------
            }
        } catch (err) {
            console.error("Error polling server status:", err);
        }
    }, 500);
}

export async function startOrchestrator() {
    const versionSelect = document.getElementById('main-version-select');
    const modelSelect = document.getElementById('main-model-select');
    const portInput = document.getElementById('orchestrator-port-input');

    if (!versionSelect.value || !modelSelect.value) {
        alert("Please select both Orchestrator Version and Model!");
        return;
    }

    // --- ИСПРАВЛЕННЫЙ СБОР ЛОКАЛЬНЫХ GPU (ИЗ ХЕДЕРА) ---
    const selectedLocalGpus = Array.from(document.querySelectorAll('.local-gpu-toggle:checked'))
        .map(checkbox => parseInt(checkbox.dataset.gpuIndex, 10));
    console.log('Main Server Local GPUs:', selectedLocalGpus);

    // --- 2. SMART CLUSTER START (СБОР НОД И ИХ КАРТ) ---
    const activeToggles = document.querySelectorAll('.node-enable-toggle:checked');
    const activeNodes = Array.from(activeToggles).map(toggle => ({
        nodeId: toggle.dataset.nodeId,
        ip: toggle.dataset.nodeIp
    }));

    let rpcEndpoints = [];

    if (activeNodes.length > 0) {
        const rpcStartPromises = activeNodes.map(node => {
            const select = document.getElementById(`select-${node.nodeId}`);
            const nodePortInput = document.getElementById(`rpc-port-${node.nodeId}`);

            if (!select || !select.value) return Promise.resolve();

            // СБОРКА GPU КОНКРЕТНО ДЛЯ ЭТОЙ УДАЛЕННОЙ НОДЫ
            // Используем ID ноды в селекторе, чтобы не захватить чужие карты!
            const nodeSelectedGpus = Array.from(document.querySelectorAll(`#node-${node.nodeId} .gpu-toggle:checked`))
                .map(checkbox => parseInt(checkbox.dataset.gpuIndex, 10));

            console.log(`Node ${node.nodeId}: Remote GPUs selected:`, nodeSelectedGpus);

            const versionData = JSON.parse(select.value);
            const rpcPort = parseInt(nodePortInput.value) || 50052;

            rpcEndpoints.push(`${node.ip}:${rpcPort}`);

            // Отправляем команду ноде запустить RPC-сервер только с её выбранными картами
            return startRpc(node.nodeId, versionData.version_tag, rpcPort, nodeSelectedGpus);
        });

        await Promise.all(rpcStartPromises);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Прогрев
    }

    // --- 3. ЗАПУСК ГЛАВНОГО ПРОЦЕССА ---
    const launch_params = {
        c: document.getElementById('param-c').value,
        ngl: document.getElementById('param-ngl').value,
        cache_type_k: document.getElementById('param-cache-k').value,
        cache_type_v: document.getElementById('param-cache-v').value,
        flash_attn: document.getElementById('param-fa').checked,
        no_mmap: document.getElementById('param-mmap').checked,
        disable_local_gpu: document.getElementById('param-disable-local').checked,
        fit: document.getElementById('param-fit').value,
        custom_args: document.getElementById('param-custom').value
    };

    try {
        const versionData = JSON.parse(versionSelect.value);
        await fetch('/api/orchestrator/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                version_tag: versionData.version_tag,
                model_path: modelSelect.value,
                port: parseInt(portInput.value) || 8080,
                rpc_endpoints: rpcEndpoints.join(','),
                launch_params: launch_params,
                selected_gpus: selectedLocalGpus // ПЕРЕДАЕМ ТОЛЬКО ЛОКАЛЬНЫЕ ИНДЕКСЫ
            })
        });

        updateOrchestratorStatus();
    } catch (error) {
        console.error("Error starting orchestrator:", error);
    }
}

export async function stopOrchestrator() {
    // 1. Выключаем главного Оркестратора
    const result = await stopOrchestratorProcess();
    console.log("Stop orchestrator response:", result);

    // 2. Рассылаем команду остановки на ВСЕ известные ноды в UI (для надежности)
    const allToggles = document.querySelectorAll('.node-enable-toggle');
    allToggles.forEach(toggle => {
        const nodeId = toggle.dataset.nodeId;
        if (nodeId) stopRpc(nodeId);
    });

    updateOrchestratorStatus();
}

export async function updateOrchestratorStatus() {
    try {
        const response = await fetch('/api/orchestrator/status');
        const status = await response.json();

        const statusText = document.getElementById('orchestrator-status-text');
        const logsElement = document.getElementById('orchestrator-logs');

        // ВСЕГДА обновляем окно логов, если они есть (даже в состоянии READY)
        if (status.logs && status.logs.length > 0) {
            // Проверяем, находится ли ползунок прокрутки в самом низу (с погрешностью в 15 пикселей)
            const isScrolledToBottom = logsElement.scrollHeight - logsElement.clientHeight <= logsElement.scrollTop + 15;

            logsElement.innerHTML = status.logs.join('\n');

            // Скроллим вниз ТОЛЬКО если пользователь не листал вверх
            if (isScrolledToBottom) {
                logsElement.scrollTop = logsElement.scrollHeight;
            }
        }

        if (status.state === "STOPPED") {
            statusText.innerHTML = `<span class="text-red-500 font-bold">Stopped</span>`;
            if (!status.logs || status.logs.length === 0) {
                logsElement.innerHTML = "Server is stopped.";
            }
        } else if (status.state === "LOADING") {
            statusText.innerHTML = `<span class="text-yellow-500 font-bold animate-pulse">Loading Model... (PID: ${status.pid})</span>`;
        } else if (status.state === "READY") {
            const port = status.port || 8080;
            const webUrl = `http://${window.location.hostname}:${port}`;
            const apiUrl = `http://${window.location.hostname}:${port}/v1`;
            statusText.innerHTML = `✅ <span class="text-green-400 font-bold">Ready!</span> <a href="${webUrl}" target="_blank" class="text-blue-400 hover:text-blue-300 underline mx-1">Web UI</a> | API: <code class="bg-gray-800 text-gray-300 px-2 py-1 rounded cursor-pointer hover:bg-gray-700 transition-colors" title="Click to copy" onclick="copyToClipboard('${apiUrl}', this)">${apiUrl}</code>`;
        }
    } catch (error) {
        console.error("Error fetching orchestrator status:", error);
    }
}

// --- Local Storage State Management ---

export function saveFormState() {
    try {
        const state = {
            model: document.getElementById('main-model-select')?.value || "",
            c: document.getElementById('param-c')?.value || 32768,
            ngl: document.getElementById('param-ngl')?.value || 99,
            cache_k: document.getElementById('param-cache-k')?.value || "f16",
            cache_v: document.getElementById('param-cache-v')?.value || "f16",
            fit: document.getElementById('param-fit')?.value || "",
            custom: document.getElementById('param-custom')?.value || "",
            disable_local: document.getElementById('param-disable-local')?.checked || false,
            fa: document.getElementById('param-fa')?.checked || false,
            mmap: document.getElementById('param-mmap')?.checked || false
        };
        localStorage.setItem('orchestratorState', JSON.stringify(state));
    } catch (e) {
        console.error("Failed to save state", e);
    }
}

export function restoreFormState() {
    try {
        const saved = localStorage.getItem('orchestratorState');
        if (!saved) return;
        const state = JSON.parse(saved);

        if (state.model) {
            const modelSelect = document.getElementById('main-model-select');
            if (modelSelect && modelSelect.querySelector(`option[value="${state.model}"]`)) {
                modelSelect.value = state.model;
            }
        }
        if (state.c) document.getElementById('param-c').value = state.c;
        if (state.ngl) document.getElementById('param-ngl').value = state.ngl;
        if (state.cache_k) document.getElementById('param-cache-k').value = state.cache_k;
        if (state.cache_v) document.getElementById('param-cache-v').value = state.cache_v;
        if (state.fit) document.getElementById('param-fit').value = state.fit;
        if (state.custom) document.getElementById('param-custom').value = state.custom;

        const disableLocalEl = document.getElementById('param-disable-local');
        if(disableLocalEl) disableLocalEl.checked = !!state.disable_local;

        const faEl = document.getElementById('param-fa');
        if(faEl) faEl.checked = !!state.fa;

        const mmapEl = document.getElementById('param-mmap');
        if(mmapEl) mmapEl.checked = !!state.mmap;
    } catch (e) {
        console.error("Failed to restore state", e);
    }
}

export function copyAllLogs() {
    const logsElement = document.getElementById('orchestrator-logs');
    const btn = document.getElementById('btn-copy-logs');
    if (!logsElement || !btn) return;

    // Копируем текст из терминала
    navigator.clipboard.writeText(logsElement.innerText).then(() => {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = "✅ Copied!";
        btn.classList.add("text-green-400");
        btn.classList.remove("text-gray-300");

        // Возвращаем как было через 2 секунды
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove("text-green-400");
            btn.classList.add("text-gray-300");
        }, 2000);
    }).catch(err => {
        console.error("Failed to copy logs: ", err);
    });
}
