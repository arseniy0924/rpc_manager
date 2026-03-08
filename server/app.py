"""
Main application entry point for the RPC Manager Server.

This module implements the Application Factory pattern to create and configure
the Flask application. It registers blueprints and initializes extensions.
"""
# Принудительно заставляем PyInstaller увидеть эти библиотеки
import charset_normalizer
import chardet
import requests

import logging
import os
import sys
import threading
import time
import psutil
import pynvml
from flask import Flask
from server.extensions import socketio
from server.routes.web import web_bp
from server.routes.api import api_bp
from server.services.discovery import ServerDiscovery

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Отключаем спам от Flask (запросы GET 200) ---
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)
# -----------------------------------------------------------

# --- Функция для поиска папок после сборки в EXE и в PyCharm ---
def get_resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    if hasattr(sys, '_MEIPASS'):
        # PyInstaller распаковывает файлы во временную папку _MEIPASS
        return os.path.join(sys._MEIPASS, relative_path)

    # Бронебойный путь для разработки (отталкиваемся от самого файла app.py)
    # __file__ указывает на .../rpc_manager/server/app.py
    current_dir = os.path.dirname(os.path.abspath(__file__)) # Это папка server
    project_root = os.path.dirname(current_dir)              # Это папка rpc_manager

    return os.path.join(project_root, relative_path)
# ---------------------------------------------------

def get_server_telemetry():
    """
    Собирает телеметрию ресурсов основного сервера.
    """
    try:
        # CPU usage
        cpu_percent = psutil.cpu_percent(interval=1)
        
        # RAM usage
        memory = psutil.virtual_memory()
        ram_used_gb = memory.used / (1024**3)
        ram_total_gb = memory.total / (1024**3)
        
        # GPU info (если доступны)
        gpus = []
        try:
            pynvml.nvmlInit()
            device_count = pynvml.nvmlDeviceGetCount()
            for i in range(device_count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                gpu_name = pynvml.nvmlDeviceGetName(handle)
                gpu_temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
                gpu_util = pynvml.nvmlDeviceGetUtilizationRates(handle).gpu
                gpu_memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
                gpu_used_gb = gpu_memory.used / (1024**3)
                gpu_total_gb = gpu_memory.total / (1024**3)
                
                gpus.append({
                    'name': gpu_name,
                    'temp': gpu_temp,
                    'util': gpu_util,
                    'used_gb': round(gpu_used_gb, 2),
                    'total_gb': round(gpu_total_gb, 2)
                })
        except Exception as e:
            logger.warning(f"GPU telemetry error: {e}")
        
        return {
            'cpu_percent': round(cpu_percent, 1),
            'ram_used': round(ram_used_gb, 2),
            'ram_total': round(ram_total_gb, 2),
            'gpus': gpus
        }
    except Exception as e:
        logger.error(f"Error collecting server telemetry: {e}")
        return None

def server_telemetry_worker():
    """
    Фоновая задача для отправки телеметрии сервера каждые 3 секунды.
    Также проверяет таймауты нод и логирует отключения.
    """
    # Храним время последнего хартбита для каждой ноды
    last_heartbeat = {}
    
    while True:
        try:
            # 1. Отправляем телеметрию сервера
            data = get_server_telemetry()
            if data:
                socketio.emit('server_telemetry', data)
            
            # 2. Проверяем таймауты нод
            current_time = time.time()
            timeout_threshold = 10  # секунд
            
            # Создаем копию ключей, чтобы избежать изменения словаря во время итерации
            node_ids = list(ACTIVE_NODES.keys())
            
            for node_id in node_ids:
                node_data = ACTIVE_NODES.get(node_id, {})
                last_seen = node_data.get('last_seen', 0)
                
                # Обновляем время последнего хартбита
                if 'timestamp' in node_data:
                    last_heartbeat[node_id] = node_data['timestamp']
                elif node_id not in last_heartbeat:
                    # Если нода есть в ACTIVE_NODES, но нет в last_heartbeat, 
                    # значит она была добавлена вручную (например, через /command)
                    # Считаем, что она была "видена" недавно
                    last_heartbeat[node_id] = current_time
                
                # Проверяем таймаут
                last_seen_time = last_heartbeat.get(node_id, 0)
                if current_time - last_seen_time > timeout_threshold:
                    # Нода ушла в таймаут
                    hostname = node_data.get('hostname', 'Unknown')
                    logger.info(f"🔴 Node disconnected: {hostname} ({node_id})")
                    
                    # Удаляем ноду из активных
                    del ACTIVE_NODES[node_id]
                    if node_id in last_heartbeat:
                        del last_heartbeat[node_id]
                    
                    # Уведомляем клиентов об удалении ноды
                    socketio.emit('node_removed', {'node_id': node_id})
                    
        except Exception as e:
            logger.error(f"Error in telemetry worker: {e}")
        time.sleep(3)

def create_app():
    """
    Application Factory function.
    """
    # Определяем пути до папок со статикой и шаблонами
    template_dir = get_resource_path('server/templates')
    static_dir = get_resource_path('server/static')

    app = Flask(__name__,
                template_folder=template_dir,
                static_folder=static_dir,
                static_url_path='/static')

    app.config['SECRET_KEY'] = 'rpc_manager_secret_key'

    # Initialize SocketIO with the app
    socketio.init_app(app, cors_allowed_origins="*", async_mode='threading')

    # Register Blueprints
    app.register_blueprint(web_bp)
    app.register_blueprint(api_bp, url_prefix='/api')

    return app

if __name__ == '__main__':
    app = create_app()

    # Initialize mDNS discovery
    discovery = ServerDiscovery(port=5000)

    try:
        discovery.register()
        
        # Start telemetry worker in background thread
        telemetry_thread = threading.Thread(target=server_telemetry_worker, daemon=True)
        telemetry_thread.start()
        
        # Run the server using SocketIO
        logger.info("Starting Flask-SocketIO server on 0.0.0.0:5000")
        socketio.run(app, host='0.0.0.0', port=5000, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)
    except KeyboardInterrupt:
        logger.info("Server stopping...")
    finally:
        discovery.unregister()
