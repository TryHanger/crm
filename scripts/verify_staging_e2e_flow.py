#!/usr/bin/env python3
"""
SaaS CRM - Containerized Staging E2E Verification over Real HTTPS / Nginx
Validates the complete business lifecycle against the running Docker Compose Staging stack:
  1. Strict TLS SNI Handshake & Verification against Nginx
  2. Platform Owner Bootstrap Login
  3. Dynamic Pilot Tenant Provisioning
  4. Business Owner Invite Acceptance & Authentication
  5. Pre-Publication Inactive Rejection (404)
  6. Configuration of Branch, Service, Staff, Services Mapping & Schedule
  7. Tenant Online Booking Publication
  8. Anonymous Public Client Discovery & Availability Slot Search
  9. Anonymous Public Client Appointment Booking
 10. CRM Appointment Intake & Verification
 11. Pause / Unpublish Rejection (404)
 12. Strict Multi-Tenant Isolation Assertion
"""

import os
import sys
import json
import uuid
import socket
import ssl
import datetime
import argparse
from typing import Dict, Any, Tuple, Optional

# Add repo root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class StagingTlsHttpClient:
    """Client for executing verified HTTP/1.1 requests over TLS with SNI and strict hostname checks."""

    def __init__(self, ip_target: str = "127.0.0.1", port: int = 443, ca_cert: str = "nginx/certs/fullchain.pem", check_hostname: bool = True):
        self.ip_target = ip_target
        self.port = port
        self.ca_cert = ca_cert
        self.check_hostname = check_hostname

    def request(
        self,
        server_hostname: str,
        path: str,
        method: str = "GET",
        headers: Optional[Dict[str, str]] = None,
        body: Optional[str] = None,
        timeout: float = 12.0
    ) -> Tuple[int, Dict[str, str], str]:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        if self.ca_cert and os.path.exists(self.ca_cert):
            ctx.load_verify_locations(cafile=self.ca_cert)
            ctx.verify_mode = ssl.CERT_REQUIRED
        else:
            ctx.verify_mode = ssl.CERT_NONE
        ctx.check_hostname = self.check_hostname

        raw_sock = socket.create_connection((self.ip_target, self.port), timeout=timeout)
        ssock = ctx.wrap_socket(raw_sock, server_hostname=server_hostname)

        req_headers = {
            "Host": server_hostname,
            "User-Agent": "CRM-Staging-E2E-Runner/1.0",
            "Connection": "close",
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


def load_staging_credentials(env_path: str = ".env.staging") -> Dict[str, str]:
    """Reads environment variables from .env.staging file."""
    creds = {}
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    creds[k.strip()] = v.strip().strip('"').strip("'")
    return creds


def run_staging_e2e_flow(
    env_path: str = ".env.staging",
    ca_cert: str = "nginx/certs/fullchain.pem"
) -> Dict[str, Any]:
    print("\n" + "=" * 80)
    print("  RUNNING CONTAINERIZED HTTPS E2E VERIFICATION ON STAGING STACK")
    print("=" * 80)

    creds = load_staging_credentials(env_path)
    platform_admin_email = creds.get("INITIAL_PLATFORM_OWNER_EMAIL", "admin@staging.crm.internal")
    platform_admin_password = creds.get("INITIAL_PLATFORM_OWNER_PASSWORD", "")

    assert platform_admin_password, f"INITIAL_PLATFORM_OWNER_PASSWORD not found in {env_path}"

    client = StagingTlsHttpClient(ca_cert=ca_cert, check_hostname=True)
    report_steps = []

    # --------------------------------------------------------------------------
    # Step 1: Strict TLS SNI Check & Platform Owner Login via Nginx HTTPS
    # --------------------------------------------------------------------------
    print("\n[Step 1] Authenticating Platform Owner over verified HTTPS...")
    login_body = json.dumps({"email": platform_admin_email, "password": platform_admin_password})
    st, hdrs, body = client.request(
        server_hostname="console.staging.crm.internal",
        path="/api/v1/auth/login",
        method="POST",
        headers={"Content-Type": "application/json"},
        body=login_body
    )
    assert st == 200, f"Platform Owner login failed with status {st}: {body}"
    token_resp = json.loads(body)
    platform_token = token_resp["access_token"]
    print(f"    [+] Platform Owner authenticated. Access token received.")
    report_steps.append({"step": "platform_owner_login", "status": st, "passed": True})

    # --------------------------------------------------------------------------
    # Step 2: Provision a Fresh Tenant (No Demo Seed)
    # --------------------------------------------------------------------------
    slug_suffix = uuid.uuid4().hex[:6]
    tenant_slug = f"pilot-{slug_suffix}"
    tenant_name = f"Pilot Salon {tenant_slug.upper()}"
    owner_email = f"owner.{tenant_slug}@pilot-staging.internal"
    owner_temp_pass = f"PilotOwnerPass_{slug_suffix}!99"

    print(f"\n[Step 2] Provisioning new company tenant '{tenant_slug}'...")
    create_tenant_payload = json.dumps({
        "slug": tenant_slug,
        "display_name": tenant_name,
        "owner_email": owner_email,
        "owner_name": "Test Salon Owner",
        "vertical": "barbershop",
        "plan_code": "start"
    })
    st, hdrs, body = client.request(
        server_hostname="console.staging.crm.internal",
        path="/api/v1/platform/tenants",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {platform_token}"
        },
        body=create_tenant_payload
    )
    assert st == 201, f"Tenant creation failed with status {st}: {body}"
    tenant_data = json.loads(body)
    tenant_id = tenant_data["tenant_id"]
    invite_url = tenant_data.get("invite_url") or ""
    invite_token = tenant_data.get("invite_token")
    if not invite_token and "token=" in invite_url:
        invite_token = invite_url.split("token=")[1].split("&")[0]

    assert invite_token, f"Invite token not returned for new tenant: {tenant_data}"
    print(f"    [+] Tenant created: ID={tenant_id}, Slug={tenant_slug}, Invite token={invite_token[:8]}...")
    report_steps.append({"step": "tenant_provisioning", "tenant_id": tenant_id, "slug": tenant_slug, "passed": True})

    # --------------------------------------------------------------------------
    # Step 3: Business Owner Accepts Invite
    # --------------------------------------------------------------------------
    print(f"\n[Step 3] Accepting Business Owner invitation...")
    accept_payload = json.dumps({
        "token": invite_token,
        "password": owner_temp_pass,
        "display_name": "Test Salon Owner"
    })
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path="/api/v1/auth/accept-invite",
        method="POST",
        headers={"Content-Type": "application/json"},
        body=accept_payload
    )
    assert st == 200, f"Invite acceptance failed with status {st}: {body}"
    owner_token_resp = json.loads(body)
    business_token = owner_token_resp["access_token"]
    print(f"    [+] Business Owner password set & session activated.")
    report_steps.append({"step": "accept_owner_invite", "status": st, "passed": True})

    # --------------------------------------------------------------------------
    # Step 4: Verify Pre-Publication Access Rejection (404)
    # --------------------------------------------------------------------------
    booking_hostname = f"{tenant_slug}.book.staging.crm.internal"
    print(f"\n[Step 4] Checking public site BEFORE publication on '{booking_hostname}'...")
    st, hdrs, body = client.request(
        server_hostname=booking_hostname,
        path="/api/v1/public/site",
        method="GET"
    )
    assert st == 404, f"Expected 404 for unpublished tenant, got {st}: {body}"
    print(f"    [+] Pre-publication correctly rejected with HTTP 404.")
    report_steps.append({"step": "pre_publication_404_check", "status": st, "passed": True})

    # --------------------------------------------------------------------------
    # Step 5: Configure Business CRM Entities (Branch, Service, Staff, Schedule)
    # --------------------------------------------------------------------------
    print(f"\n[Step 5] Configuring Business CRM entities...")
    crm_headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {business_token}"
    }

    # 5a. Create Branch
    branch_payload = json.dumps({
        "name": "Central Branch",
        "address": "Kabanbay Batyr Ave 1",
        "city": "Astana",
        "timezone_iana": "Asia/Almaty",
        "phone": "+77011112233"
    })
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path="/api/v1/business/branches",
        method="POST",
        headers=crm_headers,
        body=branch_payload
    )
    assert st == 201, f"Create branch failed with status {st}: {body}"
    branch_data = json.loads(body)
    branch_id = branch_data["id"]
    print(f"    [+] Branch created: ID={branch_id}, Name='Central Branch'")

    # 5b. Create Service
    service_payload = json.dumps({
        "name": "Staging Master Cut",
        "base_price_minor": 650000,
        "base_duration_minutes": 60,
        "active": True,
        "online_visible": True
    })
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path="/api/v1/business/services",
        method="POST",
        headers=crm_headers,
        body=service_payload
    )
    assert st == 201, f"Create service failed with status {st}: {body}"
    service_data = json.loads(body)
    service_id = service_data["id"]
    print(f"    [+] Service created: ID={service_id}, Name='Staging Master Cut'")

    # 5c. Create Staff Member
    staff_payload = json.dumps({
        "display_name": "Alikhan Master",
        "role_title": "Senior Barber",
        "online_bookable": True,
        "branch_ids": [branch_id]
    })
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path="/api/v1/business/staff",
        method="POST",
        headers=crm_headers,
        body=staff_payload
    )
    assert st == 201, f"Create staff failed with status {st}: {body}"
    staff_data = json.loads(body)
    staff_id = staff_data["id"]
    print(f"    [+] Staff member created: ID={staff_id}")

    # 5d. Map Staff to Service & Branch
    assign_payload = json.dumps([{
        "branch_id": branch_id,
        "service_id": service_id,
        "price_override_minor": 650000,
        "duration_override_minutes": 60,
        "active": True,
        "online_visible": True
    }])
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path=f"/api/v1/business/staff/{staff_id}/services",
        method="PUT",
        headers=crm_headers,
        body=assign_payload
    )
    assert st == 200, f"Assign staff services failed with status {st}: {body}"
    print(f"    [+] Staff member assigned to service and branch.")

    # 5e. Set Staff Working Schedule (Monday-Sunday 09:00 - 19:00)
    shifts = [
        {"weekday_iso": day, "local_start": "09:00", "local_end": "19:00", "is_working": True, "breaks": []}
        for day in range(1, 8)
    ]
    schedule_payload = json.dumps({"shifts": shifts})
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path=f"/api/v1/business/staff/{staff_id}/schedule?branch_id={branch_id}",
        method="PUT",
        headers=crm_headers,
        body=schedule_payload
    )
    assert st == 200, f"Update schedule failed with status {st}: {body}"
    print(f"    [+] Weekly schedule configured for staff member.")
    report_steps.append({"step": "configure_entities", "branch_id": branch_id, "service_id": service_id, "staff_id": staff_id, "passed": True})

    # --------------------------------------------------------------------------
    # Step 6: Publish Booking Settings
    # --------------------------------------------------------------------------
    print(f"\n[Step 6] Publishing online booking for '{tenant_slug}'...")
    pub_payload = json.dumps({"is_published": True})
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path="/api/v1/business/booking-publication/publish?publish=true",
        method="POST",
        headers=crm_headers,
        body=pub_payload
    )
    assert st == 200, f"Publish failed with status {st}: {body}"
    pub_resp = json.loads(body)
    assert pub_resp.get("is_published") is True, f"Expected is_published=True, got {pub_resp}"
    print(f"    [+] Booking successfully published! Public site is active.")
    report_steps.append({"step": "publish_booking", "passed": True})

    # --------------------------------------------------------------------------
    # Step 7: Public Client Site Discovery & Available Slots Check
    # --------------------------------------------------------------------------
    print(f"\n[Step 7] Anonymous public client queries published site over HTTPS...")
    st, hdrs, body = client.request(
        server_hostname=booking_hostname,
        path="/api/v1/public/site",
        method="GET"
    )
    assert st == 200, f"Public site returned {st}: {body}"
    site_info = json.loads(body)
    assert site_info.get("slug") == tenant_slug, f"Slug mismatch: {site_info}"
    print(f"    [+] Public site resolved: Name='{site_info.get('display_name')}', Published={site_info.get('is_published')}")

    # Search availability slots for upcoming days
    today = datetime.datetime.now(datetime.timezone.utc).date()
    search_payload = json.dumps({
        "branch_id": branch_id,
        "service_ids": [service_id],
        "from_date": (today + datetime.timedelta(days=2)).isoformat(),
        "to_date": (today + datetime.timedelta(days=5)).isoformat(),
        "staff_id": staff_id,
        "staff_mode": "specific"
    })
    st, hdrs, body = client.request(
        server_hostname=booking_hostname,
        path="/api/v1/public/availability/search",
        method="POST",
        headers={"Content-Type": "application/json"},
        body=search_payload
    )
    assert st == 200, f"Availability search returned {st}: {body}"
    avail_data = json.loads(body)
    slots = avail_data.get("slots", [])
    assert len(slots) > 0, f"No slots returned: {avail_data}"
    selected_slot = slots[0]
    starts_at_utc = selected_slot.get("starts_at_utc")
    price_minor = selected_slot.get("price_minor", 650000)
    print(f"    [+] Found {len(slots)} available slots. Selected: {starts_at_utc}")
    report_steps.append({"step": "public_discovery_and_slots", "slots_count": len(slots), "passed": True})

    # --------------------------------------------------------------------------
    # Step 8: Anonymous Public Client Creates Booking
    # --------------------------------------------------------------------------
    print(f"\n[Step 8] Creating public client appointment booking...")
    booking_req_body = json.dumps({
        "branch_id": branch_id,
        "staff_id": staff_id,
        "service_ids": [service_id],
        "starts_at_utc": starts_at_utc,
        "customer_name": "Serik Pilot Client",
        "customer_phone": "+77019998877",
        "customer_email": "serik.client@test.kz",
        "notes": "Verified Staging Container E2E appointment",
        "expected_price_minor": price_minor
    })
    st, hdrs, body = client.request(
        server_hostname=booking_hostname,
        path="/api/v1/public/bookings",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Idempotency-Key": f"e2e-{uuid.uuid4()}"
        },
        body=booking_req_body
    )
    assert st == 201, f"Public booking creation failed with status {st}: {body}"
    booking_resp = json.loads(body)
    created_booking_id = booking_resp.get("booking_id") or booking_resp.get("id")
    mgmt_token = booking_resp.get("management_token") or booking_resp.get("manage_token")
    print(f"    [+] Booking created successfully! ID={created_booking_id}, Ref={booking_resp.get('public_ref')}")
    report_steps.append({"step": "public_booking_created", "booking_id": created_booking_id, "passed": True})

    # --------------------------------------------------------------------------
    # Step 9: Business CRM Verification of Appointment Card
    # --------------------------------------------------------------------------
    print(f"\n[Step 9] Verifying appointment card in Business CRM as Business Owner...")
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path=f"/api/v1/business/bookings/{created_booking_id}",
        method="GET",
        headers=crm_headers
    )
    assert st == 200, f"Fetching CRM booking card failed with status {st}: {body}"
    card = json.loads(body)
    assert card.get("id") == created_booking_id, f"Card ID mismatch: {card}"
    assert card.get("status") in ("pending", "confirmed"), f"Unexpected booking status: {card.get('status')}"
    customer_info = card.get("customer", {})
    assert "Serik" in customer_info.get("name", ""), f"Customer name mismatch in CRM: {customer_info}"
    print(f"    [+] CRM Booking Card verified: ID={card.get('id')}, Ref={card.get('public_ref')}, Status={card.get('status')}, Customer={customer_info.get('name')}")
    report_steps.append({"step": "crm_intake_verified", "booking_id": created_booking_id, "public_ref": card.get("public_ref"), "passed": True})

    # --------------------------------------------------------------------------
    # Step 10: Pause / Unpublish Tenant -> Verify 404
    # --------------------------------------------------------------------------
    print(f"\n[Step 10] Pausing/unpublishing booking site for '{tenant_slug}'...")
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path="/api/v1/business/booking-publication/publish?publish=false",
        method="POST",
        headers=crm_headers,
        body=json.dumps({"is_published": False})
    )
    assert st == 200, f"Unpublish failed with status {st}: {body}"
    print(f"    [+] Site unpublished in CRM settings.")

    # Check that public site now returns 404
    st, hdrs, body = client.request(
        server_hostname=booking_hostname,
        path="/api/v1/public/site",
        method="GET"
    )
    assert st == 404, f"Expected 404 for paused/unpublished tenant, got {st}: {body}"
    print(f"    [+] Paused public site correctly rejected with HTTP 404!")
    report_steps.append({"step": "pause_unpublish_verified", "status": st, "passed": True})

    # --------------------------------------------------------------------------
    # Step 11: Unauthenticated Access Rejection (Authentication Enforcement)
    # --------------------------------------------------------------------------
    print(f"\n[Step 11] Checking unauthenticated access rejection...")
    # Unauthenticated attempt to business CRM endpoint
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path=f"/api/v1/business/bookings/{created_booking_id}",
        method="GET"
    )
    assert st in (401, 403), f"Expected 401/403 for unauthenticated request, got {st}: {body}"
    print(f"    [+] Unauthenticated CRM access blocked with HTTP {st}.")

    # Unauthenticated attempt to business profile
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path="/api/v1/business/me",
        method="GET"
    )
    assert st in (401, 403), f"Expected 401/403 for unauthenticated /business/me, got {st}: {body}"
    print(f"    [+] Unauthenticated /business/me blocked with HTTP {st}.")
    report_steps.append({"step": "unauthenticated_access_rejection", "status": st, "passed": True})

    # --------------------------------------------------------------------------
    # Step 12: Cross-Tenant Isolation with Valid JWT of Second Tenant (Owner B)
    # --------------------------------------------------------------------------
    print(f"\n[Step 12] Verifying true cross-tenant isolation with valid Owner B JWT...")
    slug_b = f"pilot-b-{uuid.uuid4().hex[:6]}"
    email_b = f"owner.{slug_b}@pilot-staging.internal"
    pass_b = f"OwnerBPass_{slug_b}!2026"

    # 12a. Provision Tenant B via Platform Console
    create_b_payload = json.dumps({
        "slug": slug_b,
        "display_name": f"Pilot Salon B {slug_b.upper()}",
        "owner_email": email_b,
        "owner_name": "Owner B",
        "vertical": "barbershop",
        "plan_code": "start"
    })
    st, hdrs, body = client.request(
        server_hostname="console.staging.crm.internal",
        path="/api/v1/platform/tenants",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {platform_token}"
        },
        body=create_b_payload
    )
    assert st == 201, f"Tenant B creation failed with status {st}: {body}"
    tenant_b_data = json.loads(body)
    invite_token_b = tenant_b_data.get("invite_token")
    if not invite_token_b and "token=" in (tenant_b_data.get("invite_url") or ""):
        invite_token_b = tenant_b_data["invite_url"].split("token=")[1].split("&")[0]

    # 12b. Owner B accepts invite and receives authentic JWT for Tenant B
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path="/api/v1/auth/accept-invite",
        method="POST",
        headers={"Content-Type": "application/json"},
        body=json.dumps({
            "token": invite_token_b,
            "password": pass_b,
            "display_name": "Owner B"
        })
    )
    assert st == 200, f"Owner B invite acceptance failed with status {st}: {body}"
    token_b = json.loads(body)["access_token"]
    print(f"    [+] Tenant B created ({slug_b}) and Owner B authenticated with valid JWT.")

    # 12c. Owner B tries to access Tenant A's booking card by ID
    crm_b_headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token_b}"
    }
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path=f"/api/v1/business/bookings/{created_booking_id}",
        method="GET",
        headers=crm_b_headers
    )
    assert st in (403, 404), f"CROSS-TENANT LEAK: Owner B was able to fetch Tenant A booking! Status: {st}, Body: {body}"
    print(f"    [+] Proven Cross-Tenant Isolation: Owner B requesting Tenant A booking {created_booking_id} rejected with HTTP {st}.")

    # 12d. Owner B queries branches (should see only Tenant B's branches, i.e. 0 branches)
    st, hdrs, body = client.request(
        server_hostname="app.staging.crm.internal",
        path="/api/v1/business/branches",
        method="GET",
        headers=crm_b_headers
    )
    assert st == 200, f"Owner B failed to fetch branches: {st}"
    branches_b = json.loads(body)
    assert len(branches_b) == 0, f"CROSS-TENANT LEAK: Owner B sees Tenant A's branches: {branches_b}"
    print(f"    [+] Owner B branches query strictly isolated: {len(branches_b)} branches returned.")

    # 12e. Verify Tenant B's public site is unpublished (404)
    st, hdrs, body = client.request(
        server_hostname=f"{slug_b}.book.staging.crm.internal",
        path="/api/v1/public/site",
        method="GET"
    )
    assert st == 404, f"Expected 404 for unpublished Tenant B, got {st}"
    print(f"    [+] Tenant B public site strictly isolated & unpublished (HTTP 404).")

    report_steps.append({
        "step": "cross_tenant_isolation_with_valid_jwt",
        "tenant_a_slug": tenant_slug,
        "tenant_b_slug": slug_b,
        "cross_access_status": st,
        "passed": True
    })

    print("\n" + "=" * 80)
    print("  ALL 12 STAGING E2E LIFECYCLE STEPS PASSED SUCCESSFULLY VIA HTTPS!")
    print("=" * 80)

    return {
        "status": "SUCCESS",
        "verified_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "tenant_slug": tenant_slug,
        "booking_id": created_booking_id,
        "steps": report_steps
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run complete E2E business lifecycle against containerized Staging")
    parser.add_argument("--env-file", default=".env.staging", help="Path to staging environment file")
    parser.add_argument("--ca-cert", default="nginx/certs/fullchain.pem", help="Path to CA certificate for TLS verification")
    parser.add_argument("--report", default="staging_e2e_report.json", help="Path to output JSON report")
    args = parser.parse_args()

    report = run_staging_e2e_flow(env_path=args.env_file, ca_cert=args.ca_cert)
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"[+] E2E report saved to '{args.report}'.")
