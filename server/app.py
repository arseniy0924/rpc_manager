"""
Main application entry point for the RPC Manager Server.

This module implements the Application Factory pattern to create and configure
the Flask application. It registers blueprints and initializes extensions.
"""

import logging
from flask import Flask
from server.extensions import socketio
from server.routes.web import web_bp
from server.routes.api import api_bp
from server.services.discovery import ServerDiscovery

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def create_app():
    """
    Application Factory function.

    Creates and configures the Flask application instance.
    Initializes extensions and registers blueprints.

    Returns:
        Configured Flask application instance.
    """
    app = Flask(__name__)
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
        # host='0.0.0.0' allows access from other machines in the LAN
        logger.info("Starting Flask-SocketIO server on 0.0.0.0:5000")
        socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=False, allow_unsafe_werkzeug=True)
    except KeyboardInterrupt:
        logger.info("Server stopping...")
    finally:
        discovery.unregister()
