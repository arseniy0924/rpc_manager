"""
Web routes for the RPC Manager dashboard.

This blueprint handles serving the main dashboard page.
"""
import logging
from flask import Blueprint, render_template
from server.extensions import ACTIVE_NODES

# Create a Blueprint for web routes
web_bp = Blueprint('web', __name__, template_folder='../templates')

logger = logging.getLogger(__name__)

@web_bp.route('/')
def index():
    """
    Renders the main dashboard page.

    This route serves the 'dashboard.html' template and passes the current
    state of the ACTIVE_NODES dictionary to it, allowing the frontend to
    display the connected nodes.

    Returns:
        Rendered HTML template for the dashboard.
    """
    logger.info("Rendering dashboard with %d active nodes.", len(ACTIVE_NODES))
    return render_template('dashboard.html', nodes=ACTIVE_NODES)
