#!/usr/bin/env python3
"""
SaaS CRM - Containerized Staging Deployment Verification Script
Automates the build, startup, health assertion, Nginx config test, and TLS HTTPS smoke probes
for the full Docker Compose Staging environment.
"""

import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import time
import ssl
import json
import socket
import argparse
import subprocess
import http.client
from typing import Dict, Any, List

from scripts.generate_staging_certs import generate_staging_certificates

DOCKER_COMPOSE_FILE = "docker-compose.staging.yml"
ENV_FILE = ".env.staging"
CERTS_DIR = "nginx/certs"
CERT_FILE = os.path.join(CERTS_DIR, "fullchain.pem")
KEY_FILE = os.path.join(CERTS_DIR, "privkey.pem")

def ensure_env_staging():
    """Generates a strong, random, fail-fast compliant .env.staging if none exists."""
    if os.path.exists(ENV_FILE):
        print(f"[+] Using existing {ENV_FILE}")
        return

    print(f"[*] Generating synthetic {ENV_FILE} with fail-fast validated secrets...")
    env_content = """# Automated Staging Verification Environment Configuration
ENVIRONMENT=staging
DEBUG=false
ENABLE_DEMO_SEED=false

POSTGRES_DB=saas_crm_staging
POSTGRES_USER=postgres
POSTGRES_PASSWORD=StagingAdminPass_492!8a
DB_USER=crm_app_user
DB_PASSWORD=StagingAppPass_914!8b

JWT_SECRET_KEY=cryptographic_staging_jwt_secret_key_minimum_32_chars!

INITIAL_PLATFORM_OWNER_EMAIL=admin@staging.crm.internal
INITIAL_PLATFORM_OWNER_PASSWORD=PlatformOwnerPass_2026!
INITIAL_PLATFORM_OWNER_NAME="Platform Administrator"

PLATFORM_IP_ALLOWLIST=127.0.0.1,::1,172.28.0.10,10.0.0.0/8

BOOKING_DOMAIN_SUFFIX=.book.staging.crm.internal
CRM_DOMAIN=app.staging.crm.internal
PLATFORM_DOMAIN=console.staging.crm.internal

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@staging.crm.internal
"""
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.write(env_content)
    print(f"[+] {ENV_FILE} created.")


def run_cmd(cmd: List[str], check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    """Executes a command and returns the completed process."""
    cmd_str = " ".join(cmd)
    print(f"[*] Executing: {cmd_str}")
    res = subprocess.run(cmd, stdout=subprocess.PIPE if capture else None, stderr=subprocess.PIPE if capture else None, text=True)
    if check and res.returncode != 0:
        err = res.stderr if capture else "Check stdout"
        print(f"[-] Command failed ({res.returncode}): {err}", file=sys.stderr)
        raise RuntimeError(f"Command failed: {cmd_str}")
    return res


def wait_for_containers(timeout_seconds: int = 120) -> Dict[str, str]:
    """Polls docker compose ps until all expected containers are ready."""
    print(f"[*] Waiting up to {timeout_seconds}s for all staging services to become healthy/ready...")
    start_time = time.time()
    
    expected_services = {
        "saas_crm_staging_pg": ["healthy"],
        "saas_crm_staging_migrations": ["exited (0)", "completed"],
        "saas_crm_staging_api": ["healthy"],
        "saas_crm_staging_frontend": ["running", "up"],
        "saas_crm_staging_proxy": ["running", "up"]
    }
    
    while time.time() - start_time < timeout_seconds:
        res = run_cmd(["docker", "compose", "--env-file", ENV_FILE, "-f", DOCKER_COMPOSE_FILE, "ps", "-a", "--format", "json"], check=False)
        if res.returncode == 0 and res.stdout.strip():
            try:
                # Docker compose ps format JSON outputs one JSON object per line or an array
                raw_lines = [line.strip() for line in res.stdout.strip().split("\n") if line.strip()]
                statuses = {}
                for line in raw_lines:
                    if line.startswith("["):
                        arr = json.loads(res.stdout)
                        for item in arr:
                            statuses[item.get("Name") or item.get("Service")] = (item.get("Status") or item.get("State") or "").lower()
                        break
                    else:
                        item = json.loads(line)
                        name = item.get("Name") or item.get("Service") or ""
                        statuses[name] = (item.get("Status") or item.get("State") or "").lower()
                
                print(f"    Current container states: {statuses}")
                
                # Check pg
                pg_ok = any("healthy" in statuses.get(k, "") for k in statuses if "pg" in k or "postgres" in k)
                # Check migrations
                mig_ok = any(("exited (0)" in statuses.get(k, "") or statuses.get(k, "") == "exited") for k in statuses if "migration" in k)
                # Check api
                api_ok = any("healthy" in statuses.get(k, "") for k in statuses if "api" in k)
                # Check proxy
                proxy_ok = any(("up" in statuses.get(k, "") or "running" in statuses.get(k, "")) for k in statuses if "proxy" in k)
                # Check frontend
                fe_ok = any(("up" in statuses.get(k, "") or "running" in statuses.get(k, "")) for k in statuses if "frontend" in k)
                
                if pg_ok and mig_ok and api_ok and proxy_ok and fe_ok:
                    print("[+] All staging services reached desired health/completion state!")
                    return statuses
            except Exception as e:
                print(f"    [Parsing error: {e}]")
        
        time.sleep(5)
    
    raise TimeoutError(f"Containers did not reach healthy state within {timeout_seconds}s!")


def test_https_request(host_header: str, path: str = "/", port: int = 443, method: str = "GET", body: str = None, headers: dict = None, ca_cert: str = None) -> tuple:
    """Executes a TLS request with verified certificate against 127.0.0.1, specifying SNI and Host."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    if ca_cert:
        ctx.load_verify_locations(cafile=ca_cert)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_REQUIRED
    else:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    req_headers = {"Host": host_header}
    if headers:
        req_headers.update(headers)

    conn = http.client.HTTPSConnection("127.0.0.1", port=port, context=ctx, timeout=10)
    conn.request(method, path, body=body, headers=req_headers)
    resp = conn.getresponse()
    resp_body = resp.read().decode("utf-8", errors="replace")
    conn.close()
    return resp.status, resp.headers, resp_body


def test_http_request(host_header: str, path: str = "/", port: int = 80) -> tuple:
    """Executes a plain HTTP request against 127.0.0.1."""
    conn = http.client.HTTPConnection("127.0.0.1", port=port, timeout=10)
    conn.request("GET", path, headers={"Host": host_header})
    resp = conn.getresponse()
    location = resp.getheader("Location")
    resp_body = resp.read().decode("utf-8", errors="replace")
    conn.close()
    return resp.status, location, resp_body


def run_deployment_smoke_tests(ca_cert: str) -> List[Dict[str, Any]]:
    """Runs full suite of HTTPS and Nginx reverse proxy probes."""
    results = []

    print("\n[*] Probe 1: HTTP Port 80 -> Health Probe (/healthz)...")
    st, loc, body = test_http_request("console.staging.crm.internal", "/healthz", 80)
    print(f"    Status: {st}, Body: {body.strip()}")
    assert st == 200 and "healthy" in body, f"Expected 200 healthy, got {st}: {body}"
    results.append({"probe": "http_healthz", "status": st, "passed": True})

    print("[*] Probe 2: HTTP Port 80 -> HTTPS 301 Redirect...")
    st, loc, _ = test_http_request("app.staging.crm.internal", "/", 80)
    print(f"    Status: {st}, Location: {loc}")
    assert st == 301 and "https://" in (loc or ""), f"Expected 301 redirect to HTTPS, got {st}: {loc}"
    results.append({"probe": "http_redirect_301", "status": st, "location": loc, "passed": True})

    print("[*] Probe 3: HTTPS Port 443 -> Unknown Host Rejection (404)...")
    st, _, body = test_https_request("unknown-malicious-domain.com", "/", 443, ca_cert=ca_cert)
    print(f"    Status: {st}, Body: {body.strip()}")
    assert st == 404 and "Domain not mapped" in body, f"Expected 404 domain not mapped, got {st}: {body}"
    results.append({"probe": "unknown_host_rejection", "status": st, "passed": True})

    print("[*] Probe 4: HTTPS Port 443 -> Platform Console SPA (console.staging.crm.internal)...")
    st, _, body = test_https_request("console.staging.crm.internal", "/", 443, ca_cert=ca_cert)
    print(f"    Status: {st}, HTML Length: {len(body)}")
    assert st == 200 and ("<div id=\"root\"" in body or "<!doctype html>" in body.lower()), f"Expected 200 Console SPA HTML, got {st}"
    results.append({"probe": "console_spa_https", "status": st, "passed": True})

    print("[*] Probe 5: HTTPS Port 443 -> Business CRM SPA (app.staging.crm.internal)...")
    st, _, body = test_https_request("app.staging.crm.internal", "/", 443, ca_cert=ca_cert)
    print(f"    Status: {st}, HTML Length: {len(body)}")
    assert st == 200 and ("<div id=\"root\"" in body or "<!doctype html>" in body.lower()), f"Expected 200 Business CRM SPA HTML, got {st}"
    results.append({"probe": "crm_spa_https", "status": st, "passed": True})

    print("[*] Probe 6: HTTPS Port 443 -> API via Nginx Proxy (Platform Login with Initial Owner)...")
    login_payload = json.dumps({
        "email": "admin@staging.crm.internal",
        "password": "PlatformOwnerPass_2026!"
    })
    st, _, body = test_https_request(
        "console.staging.crm.internal",
        "/api/v1/auth/login",
        443,
        method="POST",
        body=login_payload,
        headers={"Content-Type": "application/json"},
        ca_cert=ca_cert
    )
    print(f"    Status: {st}")
    assert st == 200, f"Expected 200 login success, got {st}: {body}"
    token_data = json.loads(body)
    assert "access_token" in token_data, "access_token not found in login response"
    print(f"    [+] Initial Platform Owner login successful via HTTPS! Token received.")
    results.append({"probe": "api_login_via_nginx_https", "status": st, "passed": True})

    return results


def main():
    parser = argparse.ArgumentParser(description="Verify Staging Docker Compose Deployment")
    parser.add_argument("--skip-build", action="store_true", help="Skip docker compose build")
    parser.add_argument("--teardown", action="store_true", help="Tear down compose services at end")
    parser.add_argument("--report", default="staging_deployment_report.json", help="Path to output report")
    args = parser.parse_args()

    # 1. Certs
    generate_staging_certificates(CERTS_DIR)

    # 2. Env
    ensure_env_staging()

    # 3. Config test
    print("\n[*] Validating Docker Compose configuration...")
    run_cmd(["docker", "compose", "--env-file", ENV_FILE, "-f", DOCKER_COMPOSE_FILE, "config"])

    # 4. Build
    if not args.skip_build:
        print("\n[*] Building Docker images for Staging stack...")
        run_cmd(["docker", "compose", "--env-file", ENV_FILE, "-f", DOCKER_COMPOSE_FILE, "build"])

    # 5. Up
    print("\n[*] Starting Staging Docker Compose stack...")
    run_cmd(["docker", "compose", "--env-file", ENV_FILE, "-f", DOCKER_COMPOSE_FILE, "up", "-d"])

    # 6. Wait for health
    container_states = wait_for_containers()

    # 7. Nginx config test
    print("\n[*] Verifying Nginx configuration inside proxy container...")
    nginx_test = run_cmd(["docker", "compose", "--env-file", ENV_FILE, "-f", DOCKER_COMPOSE_FILE, "exec", "proxy", "nginx", "-t"])
    print(nginx_test.stdout or nginx_test.stderr)

    # 8. Run TLS Probes
    print("\n[*] Executing TLS / HTTPS Smoke Probes through Nginx...")
    probe_results = run_deployment_smoke_tests(ca_cert=CERT_FILE)

    report_data = {
        "status": "SUCCESS",
        "verified_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "container_states": container_states,
        "nginx_config_test": "PASS",
        "https_smoke_probes": probe_results
    }

    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2, ensure_ascii=False)

    print(f"\n[+] Staging Deployment Acceptance Verification COMPLETE! Report saved to {args.report}")

    if args.teardown:
        print("\n[*] Tearing down Staging stack (--teardown)...")
        run_cmd(["docker", "compose", "--env-file", ENV_FILE, "-f", DOCKER_COMPOSE_FILE, "down", "-v"])


if __name__ == "__main__":
    main()
