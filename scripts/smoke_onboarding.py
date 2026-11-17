"""Smoke-тест M02 на живом локальном стеке: «создать → пригласить → войти» без dev-login.

  1. Оператор платформы через origin Platform Console создаёт компанию.
  2. Владелец активирует приглашение через origin CRM и задаёт пароль.
  3. Повторная активация той же ссылкой отклоняется.
  4. Владелец входит своим паролем и видит только свою компанию.

Запуск: python scripts/smoke_onboarding.py  (стек поднят через scripts/dev_stack.py)
"""
import argparse
import sys
import urllib.error
import urllib.parse
import uuid

from smoke_two_tenants import SmokeFailure, call, check

OPERATOR = {"email": "owner@platform.example.kz", "password": "Password123!"}


def run(console, crm):
    print("1. Оператор создаёт компанию")
    code, op = call("POST", f"{console}/api/v1/auth/login", body=OPERATOR)
    check(code == 200, "вход оператора платформы")
    slug = f"smoke-{uuid.uuid4().hex[:8]}"
    owner_email = f"owner-{slug}@example.kz"
    code, created = call("POST", f"{console}/api/v1/platform/tenants", token=op["access_token"], body={
        "slug": slug, "display_name": f"Smoke {slug}", "vertical": "barbershop",
        "owner_name": "Smoke Владелец", "owner_email": owner_email, "plan_code": "start",
    })
    check(code == 201, f"компания {slug} создана, владелец в статусе {created.get('owner_status') if isinstance(created, dict) else created}")
    link = created.get("invite_url")
    check(bool(link), "ссылка-приглашение получена (dev: письмо не настроено)")
    token = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)["token"][0]

    code, _ = call("POST", f"{crm}/api/v1/auth/login", body={"email": owner_email, "password": "Smoke-Owner-1"})
    check(code == 401, "до активации войти нельзя")

    print("2. Владелец активирует приглашение")
    code, acc = call("POST", f"{crm}/api/v1/auth/accept-invite", body={"token": token, "password": "Smoke-Owner-1"})
    check(code == 200 and acc["role"] == "owner", "приглашение принято, роль owner")

    print("3. Ссылка одноразовая")
    code, _ = call("POST", f"{crm}/api/v1/auth/accept-invite", body={"token": token, "password": "Smoke-Owner-2"})
    check(code == 400, "повторная активация отклонена")

    print("4. Вход своим паролем")
    code, login = call("POST", f"{crm}/api/v1/auth/login", body={"email": owner_email, "password": "Smoke-Owner-1"})
    check(code == 200 and login["role"] == "owner", "владелец вошёл в CRM")
    code, me = call("GET", f"{crm}/api/v1/auth/me", token=login["access_token"])
    check(code == 200 and [m["tenant_slug"] for m in me["crm_memberships"]] == [slug], "видна только своя компания")


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--console", default="http://127.0.0.1:3002", help="origin Platform Console (Vite)")
    p.add_argument("--crm", default="http://127.0.0.1:3001", help="origin Business CRM (Vite)")
    a = p.parse_args()
    try:
        run(a.console.rstrip("/"), a.crm.rstrip("/"))
    except SmokeFailure as e:
        print(f"FAIL {e}")
        return 1
    except (urllib.error.URLError, ConnectionError) as e:
        print(f"FAIL стек недоступен: {e}. Запустите python scripts/dev_stack.py")
        return 1
    print("SMOKE PASSED: создать → пригласить → войти")
    return 0


if __name__ == "__main__":
    sys.exit(main())
