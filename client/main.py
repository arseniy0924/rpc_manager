import time
import logging
import requests
import threading
from typing import Optional, List, Dict, Any

# Import local modules
try:
    from client.network import discover_server
    from client.hardware import collect_telemetry
    from client.updater import download_and_extract
    from client.runner import runner
except ImportError:
    # Fallback for running directly without package context
    from network import discover_server
    from hardware import collect_telemetry
    from updater import download_and_extract
    from runner import runner

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL = 3  # seconds

# Global state to track agent status and messages
AGENT_STATE = {
    "status": "IDLE",
    "message": ""
}

def update_task_status(msg: str):
    """Callback to update the global agent status message."""
    AGENT_STATE["message"] = msg


def handle_commands(commands: List[Dict[str, Any]]):
    """
    Parses and executes commands received from the server.
    """
    for cmd in commands:
        cmd_type = cmd.get("type")

        if cmd_type == "UPDATE_BINARY":
            url = cmd.get("url")
            version_tag = cmd.get("version_tag")

            if url and version_tag:
                logger.info(f"Received update command for version: {version_tag}")

                def update_worker():
                    AGENT_STATE["status"] = "UPDATING"
                    AGENT_STATE["message"] = f"Starting update for {version_tag}..."

                    try:
                        # ВАЖНО: передаем весь объект cmd как version_data
                        result = download_and_extract(
                            version_data=cmd,
                            version_tag=version_tag,
                            progress_callback=update_task_status
                        )
                        if result:
                            AGENT_STATE["message"] = f"Update successful. Installed at {result}"
                        else:
                            AGENT_STATE["message"] = "Update failed. Check logs."
                    except Exception as e:
                        logger.error(f"Update worker failed: {e}")
                        AGENT_STATE["message"] = f"Update error: {e}"
                    finally:
                        time.sleep(5)
                        AGENT_STATE["status"] = "IDLE"
                        AGENT_STATE["message"] = ""

                thread = threading.Thread(target=update_worker, daemon=True)
                thread.start()
            else:
                logger.warning("Invalid UPDATE_BINARY command received.")


        elif cmd_type == "START_RPC":

            version_tag = cmd.get("version_tag")

            port = cmd.get("port", 50052)

            # --- ВЫТАСКИВАЕМ МАССИВ С КАРТАМИ ---

            selected_gpus = cmd.get("selected_gpus", [])

            if version_tag:

                logger.info(f"Starting RPC server for version {version_tag} on port {port} with GPUs: {selected_gpus}")

                # --- ПЕРЕДАЕМ КАРТЫ В РУННЕР ---

                success = runner.start(version_tag=version_tag, port=port, selected_gpus=selected_gpus)

                if success:

                    AGENT_STATE["message"] = f"RPC Started ({version_tag}:{port})"

                else:

                    AGENT_STATE["message"] = "Failed to start RPC server"

            else:

                logger.warning("START_RPC command missing version_tag")

        elif cmd_type == "STOP_RPC":
            logger.info("Stopping RPC server")
            runner.stop()
            AGENT_STATE["message"] = "RPC Stopped"

def run_agent():
    """
    Main loop for the client agent.
    Discovers the server, collects telemetry, and sends heartbeats.
    """
    server_url: Optional[str] = None
    
    logger.info("Starting RPC Manager Client Agent...")

    while True:
        try:
            # 1. Discovery Phase
            if not server_url:
                logger.info("Looking for server...")
                server_url = discover_server()
                
                if not server_url:
                    logger.warning("Server not found. Retrying in 5 seconds...")
                    time.sleep(5)
                    continue
                
                logger.info(f"Connected to server at: {server_url}")

            # 2. Telemetry Collection
            telemetry_data = collect_telemetry()
            
            # Inject current agent status into telemetry
            telemetry_data["status"] = AGENT_STATE["status"]
            telemetry_data["status_message"] = AGENT_STATE["message"]
            
            # Inject runner status
            telemetry_data["llama_status"] = runner.get_status()
            
            # 3. Heartbeat Sending
            try:
                response = requests.post(
                    f"{server_url}/api/heartbeat",
                    json=telemetry_data,
                    timeout=5
                )
                
                if response.status_code == 200:
                    logger.debug("Heartbeat sent successfully.")
                    
                    # Check for commands in response
                    try:
                        resp_json = response.json()
                        commands = resp_json.get("commands", [])
                        if commands:
                            handle_commands(commands)
                    except ValueError:
                        pass # Response wasn't JSON, ignore
                        
                else:
                    logger.warning(f"Server returned status code: {response.status_code}")

            except requests.exceptions.RequestException as e:
                logger.error(f"Failed to send heartbeat: {e}")
                logger.info("Lost connection to server. Resetting discovery...")
                server_url = None
                time.sleep(5)
                continue

            # 4. Wait for next cycle
            time.sleep(HEARTBEAT_INTERVAL)

        except Exception as e:
            logger.exception(f"Unexpected error in main loop: {e}")
            time.sleep(5)

if __name__ == '__main__':
    try:
        run_agent()
    except KeyboardInterrupt:
        logger.info("Agent stopped by user.")
