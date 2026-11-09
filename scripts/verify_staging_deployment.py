#!/usr/bin/env python3
"""
SaaS CRM - Containerized Staging Deployment Verification Script
Automates the build, startup, health assertion, Nginx config test, strict TLS SNI probes,
and full containerized E2E HTTPS lifecycle verification.
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
from typing import Dict, Any, List, Tuple

from scripts.generate_staging_certs import generate_staging_certificates
from scripts.generate_staging_secrets import generate_staging_env_dict, write_env_file
from scripts.verify_staging_e2e_flow import run_staging_e2e_flow

DOCKER_COMPOSE_FILE = "docker-compose.staging.yml"
ENV_FILE = ".env.staging"
CERTS_DIR = "nginx/certs"
CERT_FILE = os.path.join(CERTS_DIR, "fullchain.pem")
KEY_FILE = os.path.join(CERTS_DIR, "privkey.pem")


def read_env_file(filepath: str) -> Dict[str, str]:
    """Parses environment key-value pairs from .env file."""
    env_vars = {}
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip().strip('"').strip("'")
    return env_vars


def ensure_env_staging(force_fresh: bool = False) -> Dict[str, str]:
    """Generates strong, random, fail-fast compliant secrets if none exists or forced."""
    if os.path.exists(ENV_FILE) and not force_fresh:
        print(f"[+] Using existing {ENV_FILE}")
        return read_env_file(ENV_FILE)

    print(f"[*] Generating synthetic {ENV_FILE} with cryptographically strong secrets...")
    env_vars = generate_staging_env_dict()
    write_env_file(ENV_FILE, env_vars)
    print(f"[+] Fresh {ENV_FILE} created with randomized passwords and JWT secret.")
    return env_vars


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

    while time.time() - start_time < timeout_seconds:
        res = run_cmd(["docker", "compose", "--env-file", ENV_FILE, "-f", DOCKER_COMPOSE_FILE, "ps", "-a", "--format", "json"], check=False)
        if res.returncode == 0 and res.stdout.strip():
            try:
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

                pg_ok = any("healthy" in statuses.get(k, "") for k in statuses if "pg" in k or "postgres" in k)
                mig_ok = any(("exited (0)" in statuses.get(k, "") or statuses.get(k, "") == "exited") for k in statuses if "migration" in k)
                api_ok = any("healthy" in statuses.get(k, "") for k in statuses if "api" in k)
                proxy_ok = any(("up" in statuses.get(k, "") or "running" in statuses.get(k, "")) for k in statuses if "proxy" in k)
                fe_ok = any(("up" in statuses.get(k, "") or "running" in statuses.get(k, "")) for k in statuses if "frontend" in k)

                if pg_ok and mig_ok and api_ok and proxy_ok and fe_ok:
                    print("[+] All staging services reached desired health/completion state!")
                    return statuses
            except Exception as e:
                print(f"    [Parsing error: {e}]")

        time.sleep(5)

    raise TimeoutError(f"Containers did not reach healthy state within {timeout_seconds}s!")


def test_tls_sni_connection(
    server_hostname: str,
    ip_target: str = "127.0.0.1",
    port: int = 443,
    ca_cert: str = None,
    check_hostname: bool = True
) -> Tuple[bool, str]:
    """
    Directly initiates a TLS handshake with strict SNI and hostname validation.
    Returns (success, message_or_cipher).
    """
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    if ca_cert and os.path.exists(ca_cert):
        ctx.load_verify_locations(cafile=ca_cert)
        ctx.verify_mode = ssl.CERT_REQUIRED
    else:
        ctx.verify_mode = ssl.CERT_NONE
    ctx.check_hostname = check_hostname

    try:
        raw_sock = socket.create_connection((ip_target, port), timeout=6)
        ssock = ctx.wrap_socket(raw_sock, server_hostname=server_hostname)
        cipher_info = f"{ssock.cipher()[0]} ({ssock.version()})"
        ssock.close()
        return True, cipher_info
    except (ssl.SSLCertVerificationError, ssl.CertificateError) as e:
        return False, f"TLS_VERIFICATION_REJECTED: {str(e)}"
    except Exception as e:
        return False, f"TLS_CONNECTION_ERROR: {str(e)}"


def test_https_request(
    server_hostname: str,
    path: str = "/",
    port: int = 443,
    method: str = "GET",
    body: str = None,
    headers: dict = None,
    ca_cert: str = None,
    check_hostname: bool = True,
    ip_target: str = "127.0.0.1"
) -> Tuple[int, Dict[str, str], str]:
    """Executes a full HTTP/1.1 request over a verified TLS SNI stream."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    if ca_cert and os.path.exists(ca_cert):
        ctx.load_verify_locations(cafile=ca_cert)
        ctx.verify_mode = ssl.CERT_REQUIRED
    else:
        ctx.verify_mode = ssl.CERT_NONE
    ctx.check_hostname = check_hostname

    raw_sock = socket.create_connection((ip_target, port), timeout=10)
    ssock = ctx.wrap_socket(raw_sock, server_hostname=server_hostname)

    req_headers = {
        "Host": server_hostname,
        "User-Agent": "CRM-Deployment-Verifier/1.0",
        "Connection": "close"
    }
    if headers:
        req_headers.update(headers)
    if body and "Content-Length" not in req_headers:
        req_headers["Content-Length"] = str(len(body.encode("utf-8")))

    req_lines = [f"{method} {path} HTTP/1.1"]
    for k, v in req_headers.items():
        req_lines.append(f"{k}: {v}")
    req_lines.append("")
    req_lines.append(body or "")
    payload = "\r\n".join(req_lines)
    ssock.sendall(payload.encode("utf-8"))

    resp_data = bytearray()
    while True:
        chunk = ssock.recv(65536)
        if not chunk:
            break
        resp_data.extend(chunk)
    ssock.close()

    raw_resp = resp_data.decode("utf-8", errors="replace")
    header_part, _, body_part = raw_resp.partition("\r\n\r\n")
    lines = header_part.split("\r\n")
    status_line = lines[0] if lines else "HTTP/1.1 500 Error"
    status_code = int(status_line.split()[1]) if len(status_line.split()) > 1 else 500

    resp_headers = {}
    for line in lines[1:]:
        if ":" in line:
            hk, hv = line.split(":", 1)
            resp_headers[hk.strip().lower()] = hv.strip()

    return status_code, resp_headers, body_part


def test_http_request(host_header: str, path: str = "/", port: int = 80) -> Tuple[int, str, str]:
    """Executes a plain HTTP request against 127.0.0.1."""
    conn = http.client.HTTPConnection("127.0.0.1", port=port, timeout=10)
    conn.request("GET", path, headers={"Host": host_header})
    resp = conn.getresponse()
    location = resp.getheader("Location")
    resp_body = resp.read().decode("utf-8", errors="replace")
    conn.close()
    return resp.status, location, resp_body


def run_deployment_smoke_tests(ca_cert: str, env_vars: Dict[str, str]) -> List[Dict[str, Any]]:
    """Runs full suite of HTTPS, SNI validation, and Nginx reverse proxy probes."""
    results = []

    # Probe 1: HTTP Port 80 Health Probe
    print("\n[*] Probe 1: HTTP Port 80 -> Health Probe (/healthz)...")
    st, loc, body = test_http_request("console.staging.crm.internal", "/healthz", 80)
    print(f"    Status: {st}, Body: {body.strip()}")
    assert st == 200 and "healthy" in body, f"Expected 200 healthy, got {st}: {body}"
    results.append({"probe": "http_healthz", "status": st, "passed": True})

    # Probe 2: HTTP Port 80 Redirect
    print("[*] Probe 2: HTTP Port 80 -> HTTPS 301 Redirect...")
    st, loc, _ = test_http_request("app.staging.crm.internal", "/", 80)
    print(f"    Status: {st}, Location: {loc}")
    assert st == 301 and "https://" in (loc or ""), f"Expected 301 redirect to HTTPS, got {st}: {loc}"
    results.append({"probe": "http_redirect_301", "status": st, "location": loc, "passed": True})

    # Probe 3: Strict TLS SNI Positive Validation (console.staging.crm.internal)
    print("[*] Probe 3: Strict TLS SNI Positive Validation (console.staging.crm.internal, check_hostname=True)...")
    ok, cipher_msg = test_tls_sni_connection("console.staging.crm.internal", ca_cert=ca_cert, check_hostname=True)
    print(f"    Handshake: {'SUCCESS' if ok else 'FAIL'} - Cipher: {cipher_msg}")
    assert ok, f"Expected TLS SNI verification success, got: {cipher_msg}"
    results.append({"probe": "tls_sni_positive_console", "cipher": cipher_msg, "passed": True})

    # Probe 4: Strict TLS SNI Negative Validation (hostname mismatch must be rejected)
    print("[*] Probe 4: Strict TLS SNI Negative Validation (untrusted-domain.invalid, check_hostname=True)...")
    ok, err_msg = test_tls_sni_connection("untrusted-domain.invalid", ca_cert=ca_cert, check_hostname=True)
    print(f"    Handshake rejection test: {'CORRECTLY REJECTED' if not ok else 'UNEXPECTED SUCCESS'}")
    assert not ok and "TLS_VERIFICATION_REJECTED" in err_msg, f"Expected TLS verification rejection, got: {err_msg}"
    print(f"    [+] TLS verification successfully rejected untrusted hostname: {err_msg.split(': ')[-1][:60]}...")
    results.append({"probe": "tls_sni_negative_rejection", "error": err_msg, "passed": True})

    # Probe 5: HTTPS Port 443 -> Unknown Host HTTP 404 Rejection
    print("[*] Probe 5: HTTPS Port 443 -> Unknown Host HTTP Rejection (404)...")
    st, _, body = test_https_request("unknown-malicious-domain.staging.crm.internal", "/", 443, ca_cert=ca_cert, check_hostname=False)
    print(f"    Status: {st}, Body: {body.strip()}")
    assert st == 404 and "Domain not mapped" in body, f"Expected 404 domain not mapped, got {st}: {body}"
    results.append({"probe": "unknown_host_rejection", "status": st, "passed": True})

    # Probe 6: HTTPS Port 443 -> Platform Console SPA
    print("[*] Probe 6: HTTPS Port 443 -> Platform Console SPA (console.staging.crm.internal)...")
    st, _, body = test_https_request("console.staging.crm.internal", "/", 443, ca_cert=ca_cert, check_hostname=True)
    print(f"    Status: {st}, HTML Length: {len(body)}")
    assert st == 200 and ("<div id=\"root\"" in body or "<!doctype html>" in body.lower()), f"Expected 200 Console SPA HTML, got {st}"
    results.append({"probe": "console_spa_https", "status": st, "passed": True})

    # Probe 7: HTTPS Port 443 -> Business CRM SPA
    print("[*] Probe 7: HTTPS Port 443 -> Business CRM SPA (app.staging.crm.internal)...")
    st, _, body = test_https_request("app.staging.crm.internal", "/", 443, ca_cert=ca_cert, check_hostname=True)
    print(f"    Status: {st}, HTML Length: {len(body)}")
    assert st == 200 and ("<div id=\"root\"" in body or "<!doctype html>" in body.lower()), f"Expected 200 Business CRM SPA HTML, got {st}"
    results.append({"probe": "crm_spa_https", "status": st, "passed": True})

    # Probe 8: HTTPS Port 443 -> Platform Owner Login via Verified Nginx Proxy
    admin_email = env_vars.get("INITIAL_PLATFORM_OWNER_EMAIL", "admin@staging.crm.internal")
    admin_password = env_vars.get("INITIAL_PLATFORM_OWNER_PASSWORD", "")
    print(f"[*] Probe 8: HTTPS Port 443 -> API Login via Nginx Proxy (Platform Owner '{admin_email}')...")
    login_payload = json.dumps({"email": admin_email, "password": admin_password})
    st, _, body = test_https_request(
        "console.staging.crm.internal",
        "/api/v1/auth/login",
        443,
        method="POST",
        body=login_payload,
        headers={"Content-Type": "application/json"},
        ca_cert=ca_cert,
        check_hostname=True
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
    parser.add_argument("--skip-e2e", action="store_true", help="Skip containerized HTTPS E2E flow")
    parser.add_argument("--force-secrets", action="store_true", help="Regenerate dynamic random secrets in .env.staging")
    parser.add_argument("--teardown", action="store_true", help="Tear down compose services at end")
    parser.add_argument("--report", default="staging_deployment_report.json", help="Path to output report")
    args = parser.parse_args()

    # 1. Certs
    generate_staging_certificates(CERTS_DIR)

    # 2. Env with dynamic cryptographic secrets
    env_vars = ensure_env_staging(force_fresh=args.force_secrets)

    report_data = {
        "status": "FAILED",
        "verified_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    try:
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

        # 8. Run Strict TLS SNI and Smoke Probes
        print("\n[*] Executing Strict TLS SNI & HTTPS Smoke Probes through Nginx...")
        probe_results = run_deployment_smoke_tests(ca_cert=CERT_FILE, env_vars=env_vars)

        # 9. Run Containerized E2E Flow over Real HTTPS
        e2e_results = None
        if not args.skip_e2e:
            print("\n[*] Executing Full Multi-Tenant E2E Lifecycle over Container HTTPS...")
            e2e_results = run_staging_e2e_flow(env_path=ENV_FILE, ca_cert=CERT_FILE)

        report_data.update({
            "status": "SUCCESS",
            "container_states": container_states,
            "nginx_config_test": "PASS",
            "https_smoke_probes": probe_results,
            "e2e_container_https_flow": e2e_results
        })

        print(f"\n[+] Staging Deployment Acceptance Verification COMPLETE! Report saved to {args.report}")

    finally:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump(report_data, f, indent=2, ensure_ascii=False)

        if args.teardown:
            print("\n[*] Tearing down Staging stack (--teardown)...")
            run_cmd(["docker", "compose", "--env-file", ENV_FILE, "-f", DOCKER_COMPOSE_FILE, "down", "-v"])


if __name__ == "__main__":
    main()
