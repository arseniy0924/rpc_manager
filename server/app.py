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

# --- Функция для поиска папок после сборки в EXE ---
def get_resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    if hasattr(sys, '_MEIPASS'):
        # PyInstaller распаковывает файлы во временную папку _MEIPASS
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)
# ---------------------------------------------------

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
        # Run the server using SocketIO
        logger.info("Starting Flask-SocketIO server on 0.0.0.0:5000")
        socketio.run(app, host='0.0.0.0', port=5000, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)
    except KeyboardInterrupt:
        logger.info("Server stopping...")
    finally:
        discovery.unregister()