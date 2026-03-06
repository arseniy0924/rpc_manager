import socket
import time
import logging
from typing import Optional
from zeroconf import ServiceInfo, Zeroconf

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_local_ip() -> str:
    """
    Reliably determines the local IPv4 address of the machine within the LAN.
    It attempts to connect to a non-routable address (10.255.255.255) to find 
    the interface used for routing.
    
    Returns:
        str: The local IP address (e.g., '192.168.1.5'). Returns '127.0.0.1' on failure.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

class ServerDiscovery:
    """
    Handles mDNS broadcasting for the RPC Manager Server using Zeroconf.
    Allows clients to automatically discover the server IP and port.
    """

    def __init__(self, port: int = 5000, service_type: str = "_rpc-manager._tcp.local."):
        """
        Initialize the discovery service.

        Args:
            port (int): The port the server is listening on.
            service_type (str): The mDNS service type.
        """
        self.port = port
        self.service_type = service_type
        self.zeroconf: Optional[Zeroconf] = None
        self.info: Optional[ServiceInfo] = None
        self.local_ip = get_local_ip()

    def register(self) -> None:
        """
        Registers the service in the local network via mDNS.
        """
        if self.zeroconf:
            logger.warning("Service already registered.")
            return

        self.zeroconf = Zeroconf()
        
        # Service name must be unique. We use the hostname.
        # Format: "Instance Name._type._tcp.local."
        hostname = socket.gethostname()
        # Ensure hostname is safe for mDNS
        safe_hostname = hostname.split('.')[0]
        service_name = f"RPC-Manager-{safe_hostname}.{self.service_type}"
        
        # Server name (host)
        server_name = f"{safe_hostname}.local."

        logger.info(f"Preparing to register service: {service_name}")
        logger.info(f"Host: {server_name}, IP: {self.local_ip}, Port: {self.port}")

        self.info = ServiceInfo(
            type_=self.service_type,
            name=service_name,
            addresses=[socket.inet_aton(self.local_ip)],
            port=self.port,
            properties={'version': '1.0.0', 'path': '/'},
            server=server_name,
        )

        try:
            self.zeroconf.register_service(self.info)
            logger.info("Service registered successfully via mDNS.")
        except Exception as e:
            logger.error(f"Failed to register service: {e}")
            self.unregister()

    def unregister(self) -> None:
        """
        Unregisters the service and closes the zeroconf instance.
        """
        if self.zeroconf:
            logger.info("Unregistering mDNS service...")
            if self.info:
                self.zeroconf.unregister_service(self.info)
            self.zeroconf.close()
            self.zeroconf = None
            self.info = None
            logger.info("Service unregistered.")

if __name__ == '__main__':
    # Example usage for testing
    discovery = ServerDiscovery(port=5000)
    try:
        discovery.register()
        print("mDNS Discovery Service is running. Press Ctrl+C to stop...")
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping discovery service...")
    finally:
        discovery.unregister()
