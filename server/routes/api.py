"""
API routes for the RPC Manager Server.

This blueprint handles API endpoints, specifically for receiving heartbeats
from agents and updating the server state.
"""
import logging
import os
from pathlib import Path
from flask import Blueprint, request, jsonify
from server.extensions import ACTIVE_NODES, socketio, SERVER_CONFIG, save_config
from server.services.github_updater import LlamaGitHubFetcher
from server.services.orchestrator import orchestrator
from server.services.server_manager import SERVER_STATE, get_server_installed_versions, start_server_update

# Create a Blueprint for API routes
api_bp = Blueprint('api', __name__)

logger = logging.getLogger(__name__)

# Initialize the GitHub fetcher
github_fetcher = LlamaGitHubFetcher()

@api_bp.route('/heartbeat', methods=['POST'])
def heartbeat():
    """
    Receives telemetry data from agents.

    This endpoint is called by agents to report their status. It updates the
    internal ACTIVE_NODES dictionary and pushes the update to connected
    dashboard clients via WebSockets.

    Returns:
        JSON response indicating success or error.
    """
    data = request.json
    if not data:
        logger.warning("Received heartbeat with no data.")
        return jsonify({"error": "No data provided"}), 400

    node_id = data.get('node_id')
    if not node_id:
        logger.warning("Received heartbeat with missing node_id.")
        return jsonify({"error": "Missing node_id"}), 400

    # Initialize node if not present, preserving pending commands if any
    if node_id not in ACTIVE_NODES:
        ACTIVE_NODES[node_id] = {}
        ACTIVE_NODES[node_id]['pending_commands'] = []
        # Log new connection
        logger.info(f"🟢 Node connected: {data.get('hostname')} ({node_id})")
    
    # Preserve existing pending commands before updating the rest of the data
    pending_commands = ACTIVE_NODES[node_id].get('pending_commands', [])
    
    # Update the node data in memory with new telemetry
    ACTIVE_NODES[node_id].update(data)
    
    # Store the IP address of the node for RPC connection
    ACTIVE_NODES[node_id]['ip'] = request.remote_addr
    
    # Обновляем timestamp для отслеживания таймаутов
    ACTIVE_NODES[node_id]['timestamp'] = time.time()
    
    # Ensure pending_commands is still there (in case data overwrote it, though update usually merges)
    ACTIVE_NODES[node_id]['pending_commands'] = pending_commands
    
    logger.debug(f"Received heartbeat from {node_id} ({data.get('hostname')})")

    # Push the update to all connected dashboard clients
    socketio.emit('node_updated', ACTIVE_NODES[node_id])

    # Extract commands to send back to the agent
    commands_to_send = []
    if pending_commands:
        commands_to_send = list(pending_commands) # Copy
        ACTIVE_NODES[node_id]['pending_commands'] = [] # Clear queue
        logger.info(f"Sending {len(commands_to_send)} pending commands to {node_id}")

    # Respond to the agent
    response = {
        "status": "ok",
        "commands": commands_to_send
    }
    return jsonify(response), 200

@api_bp.route('/command', methods=['POST'])
def queue_command():
    """
    Queues a command for a specific agent.
    
    Expected JSON:
    {
        "node_id": "...",
        "command": {
            "type": "UPDATE_BINARY",
            "url": "...",
            "version_tag": "..."
        }
    }
    """
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
        
    node_id = data.get('node_id')
    command = data.get('command')
    
    if not node_id or not command:
        return jsonify({"error": "Missing node_id or command"}), 400
        
    if node_id not in ACTIVE_NODES:
        # We can either reject or queue it for when the node appears.
        # For now, let's allow queuing even if node is offline/unknown, 
        # but we need to initialize the structure.
        ACTIVE_NODES[node_id] = {'pending_commands': []}
    
    if 'pending_commands' not in ACTIVE_NODES[node_id]:
        ACTIVE_NODES[node_id]['pending_commands'] = []
        
    ACTIVE_NODES[node_id]['pending_commands'].append(command)
    
    logger.info(f"Queued command {command.get('type')} for node {node_id}")
    
    return jsonify({"status": "queued"}), 200

@api_bp.route('/releases', methods=['GET'])
def get_releases():
    """
    Returns the latest available llama.cpp releases from GitHub.
    Uses internal caching to avoid rate limits.
    """
    try:
        versions = github_fetcher.get_available_versions()
        return jsonify(versions), 200
    except Exception as e:
        logger.error(f"Error fetching releases: {e}")
        return jsonify({"error": "Failed to fetch releases"}), 500

@api_bp.route('/config/models_path', methods=['GET', 'POST'])
def config_models_path():
    """
    GET: Returns the current models path configuration.
    POST: Updates the models path configuration.
    """
    if request.method == 'POST':
        data = request.json
        new_path = data.get('models_path')
        if new_path is not None:
            SERVER_CONFIG['models_path'] = new_path
            save_config()
            logger.info(f"Updated models path to: {new_path}")
            return jsonify({"status": "ok"}), 200
        return jsonify({"error": "Missing models_path"}), 400
    
    return jsonify({"models_path": SERVER_CONFIG.get('models_path', '')}), 200

@api_bp.route('/config/orchestrator_version', methods=['GET', 'POST'])
def config_orchestrator_version():
    """
    GET: Returns the current orchestrator version configuration.
    POST: Updates the orchestrator version configuration.
    """
    if request.method == 'POST':
        data = request.json
        new_version = data.get('orchestrator_version')
        if new_version is not None:
            SERVER_CONFIG['orchestrator_version'] = new_version
            save_config()
            logger.info(f"Updated orchestrator version to: {new_version}")
            return jsonify({"status": "ok"}), 200
        return jsonify({"error": "Missing orchestrator_version"}), 400
        
    return jsonify({"orchestrator_version": SERVER_CONFIG.get('orchestrator_version', '')}), 200

@api_bp.route('/config/orchestrator_port', methods=['GET', 'POST'])
def config_orchestrator_port():
    """
    GET: Returns the current orchestrator port configuration.
    POST: Updates the orchestrator port configuration.
    """
    if request.method == 'POST':
        data = request.json
        new_port = data.get('orchestrator_port')
        if new_port is not None:
            try:
                SERVER_CONFIG['orchestrator_port'] = int(new_port)
                save_config()
                logger.info(f"Updated orchestrator port to: {new_port}")
                return jsonify({"status": "ok"}), 200
            except ValueError:
                return jsonify({"error": "Invalid port number"}), 400
        return jsonify({"error": "Missing orchestrator_port"}), 400
        
    return jsonify({"orchestrator_port": SERVER_CONFIG.get('orchestrator_port', 8080)}), 200

@api_bp.route('/config/clients', methods=['GET'])
def get_client_configs():
    """
    Returns the saved configurations for all clients.
    """
    return jsonify({"client_configs": SERVER_CONFIG.get("client_configs", {})}), 200

@api_bp.route('/config/client/<node_id>', methods=['POST'])
def update_client_config(node_id):
    """
    Updates the saved configuration for a specific client.
    """
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
        
    version_tag = data.get('version_tag')
    
    if version_tag is not None:
        if 'client_configs' not in SERVER_CONFIG:
            SERVER_CONFIG['client_configs'] = {}
            
        SERVER_CONFIG['client_configs'][node_id] = {"version_tag": version_tag}
        save_config()
        logger.info(f"Updated config for client {node_id}: version_tag={version_tag}")
        return jsonify({"status": "ok"}), 200
        
    return jsonify({"error": "Missing version_tag"}), 400

@api_bp.route('/config/presets', methods=['GET', 'POST'])
def config_presets():
    """
    GET: Returns presets for a specific model.
    POST: Saves a preset for a specific model.
    """
    if request.method == 'GET':
        model = request.args.get('model')
        if not model:
            return jsonify({"error": "Missing model parameter"}), 400
        
        presets = SERVER_CONFIG.get("model_presets", {}).get(model, {})
        return jsonify({"presets": presets}), 200
        
    elif request.method == 'POST':
        data = request.json
        model = data.get('model')
        preset_name = data.get('preset_name')
        settings = data.get('settings')
        
        if not model or not preset_name or settings is None:
            return jsonify({"error": "Missing model, preset_name, or settings"}), 400
            
        if "model_presets" not in SERVER_CONFIG:
            SERVER_CONFIG["model_presets"] = {}
            
        if model not in SERVER_CONFIG["model_presets"]:
            SERVER_CONFIG["model_presets"][model] = {}
            
        SERVER_CONFIG["model_presets"][model][preset_name] = settings
        save_config()
        logger.info(f"Saved preset '{preset_name}' for model '{model}'")
        
        return jsonify({"status": "ok"}), 200

@api_bp.route('/config/last_model', methods=['GET', 'POST'])
def config_last_model():
    """
    GET: Returns the last selected model path.
    POST: Saves the last selected model path.
    """
    if request.method == 'GET':
        return jsonify({"last_selected_model": SERVER_CONFIG.get("last_selected_model", "")}), 200
        
    elif request.method == 'POST':
        data = request.json
        model_path = data.get('model_path')
        
        if model_path is not None:
            SERVER_CONFIG["last_selected_model"] = model_path
            save_config()
            logger.info(f"Updated last selected model to: {model_path}")
            return jsonify({"status": "ok"}), 200
            
        return jsonify({"error": "Missing model_path"}), 400

@api_bp.route('/models', methods=['GET'])
def list_models():
    """
    Scans the configured models directory for .gguf files.
    Returns a list of models with their details.
    """
    models_path_str = SERVER_CONFIG.get('models_path', '')
    
    if not models_path_str or not os.path.exists(models_path_str):
        return jsonify({"models": []}), 200
        
    models = []
    try:
        base_path = Path(models_path_str)
        # Recursively find all .gguf files
        for file_path in base_path.rglob('*.gguf'):
            if file_path.is_file():
                try:
                    size_gb = round(file_path.stat().st_size / (1024**3), 2)
                    relative_path = str(file_path.relative_to(base_path))
                    
                    models.append({
                        "name": file_path.name,
                        "relative_path": relative_path,
                        "absolute_path": str(file_path.absolute()),
                        "size_gb": size_gb
                    })
                except OSError as e:
                    logger.warning(f"Error accessing file {file_path}: {e}")
                    
    except Exception as e:
        logger.error(f"Error scanning models directory: {e}")
        return jsonify({"error": "Failed to scan models directory"}), 500
        
    return jsonify({"models": models}), 200


@api_bp.route('/orchestrator/start', methods=['POST'])
def start_orchestrator():
    """
    Starts the main llama.cpp orchestrator process.
    Uses the RPC endpoints provided by the frontend.
    """
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    model_path = data.get('model_path')
    version_tag = data.get('version_tag')
    port = data.get('port', 8080)
    launch_params = data.get('launch_params')
    selected_gpus = data.get('selected_gpus', [])  # Новый параметр

    # 1. Берем готовый список rpc_endpoints, который прислал фронтенд (тумблеры)
    rpc_endpoints_str = data.get('rpc_endpoints', '')

    if not model_path or not version_tag:
        return jsonify({"error": "Missing model_path or version_tag"}), 400

    # 2. Логируем, какие именно ноды мы выбрали для этого запуска
    if rpc_endpoints_str:
        logger.info(f"Starting orchestrator with SELECTED RPC endpoints: {rpc_endpoints_str}")
    else:
        logger.info("Starting orchestrator in LOCAL mode (no RPC endpoints provided)")

    # 3. Передаем rpc_endpoints_str и selected_gpus в метод start() нашего оркестратора
    success = orchestrator.start(
        version_tag=version_tag,
        model_path=model_path,
        rpc_endpoints=rpc_endpoints_str,  # Теперь здесь будут только включенные тумблеры
        port=int(port),
        launch_params=launch_params,
        selected_gpus=selected_gpus  # Передаем выбранные GPU
    )

    if success:
        return jsonify({"status": "started", "rpc_endpoints": rpc_endpoints_str}), 200
    else:
        return jsonify({"error": "Failed to start orchestrator"}), 500

@api_bp.route('/orchestrator/stop', methods=['POST'])
def stop_orchestrator():
    """
    Stops the main llama.cpp orchestrator process.
    """
    success = orchestrator.stop()
    if success:
        return jsonify({"status": "stopped"}), 200
    else:
        return jsonify({"error": "Failed to stop orchestrator"}), 500

@api_bp.route('/orchestrator/status', methods=['GET'])
def get_orchestrator_status():
    """
    Returns the current status of the orchestrator.
    """
    return jsonify(orchestrator.get_status()), 200

@api_bp.route('/server/versions', methods=['GET'])
def get_server_versions():
    """
    Returns a list of installed server binary versions.
    """
    return jsonify({"installed": get_server_installed_versions()}), 200


@api_bp.route('/server/update', methods=['POST'])
def update_server_binary():
    """
    Starts a background task to download and install a server binary.
    Now passes the full version data object to support multiple assets (CUDA DLLs).
    """
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # Извлекаем версию для логирования и проверки
    version_tag = data.get('version_tag')
    url = data.get('url')  # Основной бинарник

    if not url or not version_tag:
        return jsonify({"error": "Missing url or version_tag"}), 400

    # Передаем ВЕСЬ словарь данных (data) в загрузчик
    # Теперь start_server_update сможет прочитать data['extra_assets']
    start_server_update(data, version_tag)

    logger.info(f"Started full update for version {version_tag} (main + dependencies)")
    return jsonify({"status": "started"}), 200

@api_bp.route('/server/status', methods=['GET'])
def get_server_status():
    """
    Returns the current status of the server binary manager (e.g., download progress).
    """
    return jsonify(SERVER_STATE), 200
