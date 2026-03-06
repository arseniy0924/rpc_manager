import time
import socket
import logging
from typing import Optional
from zeroconf import ServiceBrowser, ServiceListener, Zeroconf, ServiceInfo

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ServerListener(ServiceListener):
    """
    Listener for mDNS service discovery events.
    Captures the first found 'RPC Manager' server.
    """
    def __init__(self):
        self.server_url: Optional[str] = None

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        """
        Called when a service is updated. Not strictly needed for simple discovery,
        but required by the interface.
        """
        pass

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        """
        Called when a service is removed.
        """
        logger.info(f"Service removed: {name}")
        # We don't necessarily clear server_url here because we might still want to try connecting,
        # or we might want to clear it if we want to support dynamic failover. 
        # For now, we keep it simple.

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        """
        Called when a service is added. Resolves service info to get IP and Port.
        """
        logger.info(f"Service found: {name}")
        info: Optional[ServiceInfo] = zc.get_service_info(type_, name)
        
        if info and info.addresses:
            # Convert bytes IP to string
            address = socket.inet_ntoa(info.addresses[0])
            port = info.port
            url = f"http://{address}:{port}"
            
            logger.info(f"Resolved server at: {url}")
            self.server_url = url

def discover_server(timeout: int = 10) -> Optional[str]:
    """
    Scans the local network for the RPC Manager server using mDNS.
    
    Args:
        timeout (int): Maximum time to wait for discovery in seconds.
        
    Returns:
        Optional[str]: The base URL of the server (e.g., 'http://192.168.1.5:5000') 
                       or None if not found.
    """
    zeroconf = Zeroconf()
    listener = ServerListener()
    service_type = "_rpc-manager._tcp.local."
    
    logger.info(f"Scanning for service: {service_type} (Timeout: {timeout}s)")
    
    browser = ServiceBrowser(zeroconf, service_type, listener)
    
    start_time = time.time()
    found_url = None
    
    try:
        while time.time() - start_time < timeout:
            if listener.server_url:
                found_url = listener.server_url
                break
            time.sleep(0.5)
    except KeyboardInterrupt:
        logger.info("Discovery interrupted by user.")
    finally:
        zeroconf.close()
        
    if found_url:
        logger.info(f"Discovery successful: {found_url}")
    else:
        logger.warning("Discovery timed out. Server not found.")
        
    return found_url

if __name__ == '__main__':
    # Test the discovery logic
    # Ensure the server is running (server/services/discovery.py) before running this.
    server = discover_server(timeout=10)
    if server:
        print(f"Server URL: {server}")
    else:
        print("Could not find server.")
