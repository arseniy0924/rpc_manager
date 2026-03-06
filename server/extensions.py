"""
Extensions module for the RPC Manager Server.

This module initializes Flask extensions and shared global variables
to avoid circular imports.
"""

import json
import os
from flask_socketio import SocketIO

# Initialize SocketIO without binding to the app yet.
# It will be initialized with the app in the application factory.
socketio = SocketIO()

# Global dictionary to store active nodes telemetry data.
# Structure: { 'node_id': { ...telemetry_data... } }
ACTIVE_NODES = {}

CONFIG_FILE = "server_config.json"

def load_config() -> dict:
    """
    Loads the server configuration from a JSON file.
    Returns a default configuration if the file doesn't exist or is invalid.
    """
    default_config = {
        "models_path": "",
        "orchestrator_version": "",
        "orchestrator_port": 8080,
        "client_configs": {},
        "model_presets": {},
        "last_selected_model": ""
    }
    
    if not os.path.exists(CONFIG_FILE):
        return default_config
        
    try:
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)
            # Merge with default to ensure all keys exist
            for key, value in default_config.items():
                if key not in config:
                    config[key] = value
            return config
    except (json.JSONDecodeError, OSError):
        return default_config

def save_config():
    """
    Saves the current SERVER_CONFIG to the JSON file.
    """
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(SERVER_CONFIG, f, indent=4)
    except OSError as e:
        print(f"Error saving config: {e}")

# Global configuration dictionary
SERVER_CONFIG = load_config()
