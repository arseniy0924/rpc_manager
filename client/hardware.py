import platform
import uuid
import socket
import json
import hashlib
import psutil
import os
from typing import Dict, List, Any, Optional

# Try to import pynvml, but don't fail if it's missing
try:
    import pynvml
    PYNVML_AVAILABLE = True
except ImportError:
    PYNVML_AVAILABLE = False

def get_node_id() -> str:
    """
    Generates a unique and persistent ID for the current node based on the MAC address.
    Returns a 16-character hex string.
    """
    mac = uuid.getnode()
    # Hash the MAC address to get a consistent string ID
    node_id = hashlib.sha256(str(mac).encode()).hexdigest()[:16]
    return node_id

def get_cpu_ram_metrics() -> Dict[str, float]:
    """
    Collects CPU and RAM usage metrics using psutil.
    Returns a dictionary with cpu_percent, ram_total_gb, and ram_used_gb.
    """
    mem = psutil.virtual_memory()
    # cpu_percent with interval=0.1 blocks for 100ms to get an accurate reading
    cpu_usage = psutil.cpu_percent(interval=0.1)
    
    return {
        "cpu_percent": cpu_usage,
        "ram_total_gb": round(mem.total / (1024 ** 3), 2),
        "ram_used_gb": round(mem.used / (1024 ** 3), 2)
    }

def get_gpu_metrics() -> List[Dict[str, Any]]:
    """
    Collects GPU metrics using pynvml if available.
    Returns a list of dictionaries containing GPU details.
    Handles initialization and shutdown of NVML safely.
    """
    gpus = []
    if not PYNVML_AVAILABLE:
        return gpus

    nvml_initialized = False
    try:
        pynvml.nvmlInit()
        nvml_initialized = True
        device_count = pynvml.nvmlDeviceGetCount()
        
        for i in range(device_count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            name = pynvml.nvmlDeviceGetName(handle)
            # pynvml might return bytes in older versions
            if isinstance(name, bytes):
                name = name.decode('utf-8')
                
            memory_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            
            try:
                utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
                load_percent = utilization.gpu
            except pynvml.NVMLError:
                load_percent = 0
            
            try:
                temp_c = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
            except pynvml.NVMLError:
                temp_c = 0

            gpus.append({
                "index": i,
                "name": name,
                "vram_total_mb": round(memory_info.total / (1024 ** 2), 2),
                "vram_used_mb": round(memory_info.used / (1024 ** 2), 2),
                "temp_c": temp_c,
                "load_percent": load_percent
            })
            
    except Exception:
        # In case of any error (no NVIDIA driver, permission issues, etc.), return empty list
        return []
    finally:
        if nvml_initialized:
            try:
                pynvml.nvmlShutdown()
            except Exception:
                pass
            
    return gpus

def get_installed_versions(base_folder: str = "bin") -> List[str]:
    """
    Scans the base folder for installed llama.cpp versions.
    Returns a list of folder names (version tags).
    """
    if not os.path.exists(base_folder):
        return []
    
    versions = []
    try:
        for entry in os.listdir(base_folder):
            full_path = os.path.join(base_folder, entry)
            if os.path.isdir(full_path):
                versions.append(entry)
    except OSError:
        pass
        
    return versions

def collect_telemetry() -> Dict[str, Any]:
    """
    Aggregates all telemetry data into a single dictionary according to the spec.
    """
    resources = get_cpu_ram_metrics()
    resources["gpus"] = get_gpu_metrics()
    
    return {
        "node_id": get_node_id(),
        "hostname": socket.gethostname(),
        "platform": f"{platform.system()} {platform.release()}",
        "status": "IDLE",
        "resources": resources,
        "installed_versions": get_installed_versions(),
        "llama_status": {
            "running": False,
            "pid": None,
            "port": 8080,
            "version": "unknown",
            "last_error": None
        }
    }

if __name__ == '__main__':
    telemetry = collect_telemetry()
    print(json.dumps(telemetry, indent=2))
