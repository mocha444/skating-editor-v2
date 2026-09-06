#!/usr/bin/env python3
"""
Stress test: 25 concurrent requests against the skating editor API
"""
import requests
import concurrent.futures
import time
import sys
from threading import Lock

BASE = "http://localhost:3001"  # app port mapped to host
DIR = "skate-c82bef30"

results_lock = Lock()
results = {"success": 0, "errors": 0, "status_codes": {}}

def reprocess():
    """Trigger reprocess and poll for result"""
    try:
        # Start reprocess
        files = {}
        data = {
            'dir': DIR,
            'threshold': '0.003',
            'min-contour': '50',
            'min-motion-frames': '8',
            'buffer-frames': '60',
            'history': '300',
            'var-threshold': '25',
            'detect-shadows': 'false',
        }
        r = requests.post(f"{BASE}/api/reprocess", data=data, timeout=30)
        
        with results_lock:
            results["status_codes"][r.status_code] = results["status_codes"].get(r.status_code, 0) + 1
            if r.status_code == 200:
                results["success"] += 1
                job_id = r.json().get("jobId")
                if job_id:
                    # Poll progress
                    for _ in range(60):
                        pr = requests.get(f"{BASE}/api/progress/{job_id}?jobId={job_id}", timeout=10)
                        if pr.status_code == 200:
                            meta = pr.json()
                            if meta.get("stage") in ("done", "error"):
                                return True
                        time.sleep(1)
            else:
                results["errors"] += 1
    except Exception as e:
        with results_lock:
            results["errors"] += 1
            print(f"Error: {e}")
    return False

def health_check():
    """Quick health check"""
    try:
        r = requests.get(f"{BASE}/", timeout=5)
        return r.status_code == 200
    except:
        return False

if __name__ == "__main__":
    print(f"Starting stress test: 25 concurrent reprocess requests")
    print(f"Target: {BASE}")
    print(f"Video dir: {DIR}")
    
    if not health_check():
        print("Health check failed - app not responding")
        sys.exit(1)
    
    print("Health check OK")
    
    start = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=25) as executor:
        futures = [executor.submit(reprocess) for _ in range(25)]
        concurrent.futures.wait(futures)
    
    elapsed = time.time() - start
    
    print(f"\n--- Results (took {elapsed:.1f}s) ---")
    print(f"Success: {results['success']}")
    print(f"Errors:  {results['errors']}")
    print(f"Status codes: {results['status_codes']}")