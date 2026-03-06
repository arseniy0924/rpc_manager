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

export async function loadPresetsForModel(modelPath) {
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

    presetSelect.onchange = () => applyPresetSettings(presetSelect.value);
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
    const presetName = document.getElementById('new-preset-name').value;

    if (!modelPath) {
        alert("Please select a model first.");
        return;
    }
    if (!presetName) {
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

    const success = await savePreset(modelPath, presetName, settings);
    if (success) {
        alert("Preset saved!");
        // Refresh presets list
        await loadPresetsForModel(modelPath);
        // Select the new preset
        document.getElementById('preset-select').value = presetName;
    } else {
        alert("Failed to save preset.");
    }
}

export function populateServerSelect() {
    const select = document.getElementById('main-version-select');
    if (!select) return;

    if (Object.keys(state.availableReleases).length === 0) return;

    const currentSelection = select.value;
    select.innerHTML = '';

    for (const releaseTag in state.availableReleases) {
        const release = state.availableReleases[releaseTag];
        for (const backendKey in release.backends) {
            const backend = release.backends[backendKey];
            const versionTag = `${release.tag_name}_${backendKey}`;

            const option = document.createElement('option');
            option.value = JSON.stringify({ url: backend.url, version_tag: versionTag });

            let text = `Llama ${release.tag_name} (${backendKey})`;
            if (state.serverInstalledVersions.includes(versionTag)) {
                text += ' ✅ (Installed)';
            }
            option.textContent = text;
            select.appendChild(option);
        }
    }

    if (currentSelection && select.querySelector(`option[value='${currentSelection}']`)) {
        select.value = currentSelection;
    } else if (state.savedOrchestratorVersion) {
        for (const option of select.options) {
            try {
                const val = JSON.parse(option.value);
                if (val.version_tag === state.savedOrchestratorVersion) {
                    select.value = option.value;
                    break;
                }
            } catch (e) {}
        }
    }

    if (!select.value && select.options.length > 0) {
        select.selectedIndex = 0;
    }
}

export async function installServerVersion() {
    const select = document.getElementById('main-version-select');
    if (!select || !select.value) {
        alert("Please select a version first.");
        return;
    }

    const selectedData = JSON.parse(select.value);

    const success = await updateServerBinary(selectedData.url, selectedData.version_tag);
    if (success) {
        console.log("Server update started");
        await saveOrchestratorConfig(selectedData.version_tag);

        // Save Port as well
        const portInput = document.getElementById('orchestrator-port-input');
        const port = parseInt(portInput.value);
        if (port) await saveOrchestratorPort(port);
    } else {
        alert("Failed to start server update.");
    }
}

export async function startOrchestrator() {
    const versionSelect = document.getElementById('main-version-select');
    const modelSelect = document.getElementById('main-model-select');
    const portInput = document.getElementById('orchestrator-port-input');

    if (!versionSelect.value || !modelSelect.value) {
        alert("Please select both Orchestrator Version and Model!");
        return;
    }

    // --- SMART CLUSTER START LOGIC ---
    const activeToggles = document.querySelectorAll('.node-enable-toggle:checked');
    const activeNodes = Array.from(activeToggles).map(toggle => ({
        nodeId: toggle.dataset.nodeId,
        ip: toggle.dataset.nodeIp
    }));

    let rpcEndpoints = [];

    if (activeNodes.length > 0) {
        console.log(`Starting RPC servers on ${activeNodes.length} nodes...`);

        // Отправляем команды на запуск RPC параллельно
        const rpcStartPromises = activeNodes.map(node => {
            const select = document.getElementById(`select-${node.nodeId}`);
            const nodePortInput = document.getElementById(`rpc-port-${node.nodeId}`);

            if (!select || !select.value) {
                console.warn(`Skipping node ${node.nodeId} - no version selected.`);
                return Promise.resolve();
            }

            const versionData = JSON.parse(select.value);
            const rpcPort = parseInt(nodePortInput.value) || 50052;

            rpcEndpoints.push(`${node.ip}:${rpcPort}`);
            return startRpc(node.nodeId, versionData.version_tag, rpcPort);
        });

        await Promise.all(rpcStartPromises);

        // Показываем в UI, что ждем прогрева
        const statusText = document.getElementById('orchestrator-status-text');
        statusText.innerHTML = `<span class="text-blue-400 font-bold animate-pulse">Warming up RPC nodes...</span>`;

        // Ждем 3 секунды (Прогрев серверов)
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    // ---------------------------------

    // Собираем параметры запуска
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
                rpc_endpoints: rpcEndpoints.join(','), // <-- Передаем строку IP:PORT
                launch_params: launch_params
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
