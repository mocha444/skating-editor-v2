#!/usr/bin/env python3
"""
Stress test concurrent polling of progress endpoints (no single-flight conflicts)
"""
import requests
import concurrent.futures
import time
import random

BASE = "http://localhost:3001"
DIR = "skate-c82bef30"

def poll_progress():
    """Poll progress endpoint with a fake job ID"""
    try:
        # Use a job ID that doesn't exist - should return 404 quickly
        job_id = f"test-{random.randint(1000, 9999)}"
        r = requests.get(f"{BASE}/api/progress/{job_id}?jobId={job_id}", timeout=10)
        return r.status_code
    except Exception as e:
        return f"error: {e}"

def health_check():
    try:
        r = requests.get(f"{BASE}/", timeout=5)
        return r.status_code == 200
    except:
        return False

if __name__ == "__main__":
    print(f"Starting concurrent polling test: 50 concurrent progress checks")
    print(f"Target: {BASE}")
    
    if not health_check():
        print("Health check failed")
        exit(1)
    
    start = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
        futures = [executor.submit(poll_progress) for _ in range(50)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]
    
    elapsed = time.time() - start
    
    status_counts = {}
    for r in results:
        status_counts[r] = status_counts.get(r, 0) + 1
    
    print(f"\n--- Results (took {elapsed:.1f}s) ---")
    print(f"Total requests: {len(results)}")
    for status, count in status_counts.items():
        print(f"  {status}: {count}")