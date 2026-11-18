"""Smoke-тест M04 на живом стеке: владелец создаёт услугу за 8000 KZT, клиент видит её в своём филиале.

  1. Владелец Barber House через origin CRM создаёт услугу 8 000 ₸.
  2. Клиент на сайте записи видит её в списке услуг своего филиала с ценой «8 000 ₸».
  3. Сайт Modern Cut эту услугу не показывает.
  4. Отрицательная цена отклоняется сервером (422).
  5. Услуга архивируется (уборка).
"""
import argparse
import sys
import urllib.error
import uuid

from smoke_two_tenants import SmokeFailure, call, check


def run(booking, crm):
    port = booking.rsplit(":", 1)[-1]
    host_a, host_b = f"barberhouse.localhost:{port}", f"moderncut.localhost:{port}"
    code, login = call("POST", f"{crm}/api/v1/auth/login", body={"email": "owner@barberhouse.kz", "password": "Password123!"})
    check(code == 200, "вход владельца Barber House")
    token = login["access_token"]

    print("1. Владелец создаёт услугу")
    name = f"Smoke стрижка {uuid.uuid4().hex[:6]}"
    code, svc = call("POST", f"{crm}/api/v1/business/services", token=token,
                     body={"name": name, "base_price_minor": 800000, "base_duration_minutes": 60})
    check(code == 201 and svc["base_price_minor"] == 800000 and svc["currency"] == "KZT", f"услуга «{name}» за 8000 KZT сохранена на сервере")
    try:
        print("2. Клиент видит её в своём филиале")
        _, branches = call("GET", f"{booking}/api/v1/public/branches", host=host_a)
        code, items = call("GET", f"{booking}/api/v1/public/services?branch_id={branches[0]['id']}", host=host_a)
        mine = [s for s in items if s["id"] == svc["id"]] if code == 200 else []
        check(len(mine) == 1 and mine[0]["price_formatted"] == "8 000 ₸", f"на сайте: {mine[0]['price_formatted'] if mine else 'нет'}")

        print("3. Другая компания её не видит")
        _, other = call("GET", f"{booking}/api/v1/public/services", host=host_b)
        check(svc["id"] not in {s["id"] for s in other}, "нет на сайте Modern Cut")

        print("4. Сервер не принимает неверную цену")
        code, _ = call("POST", f"{crm}/api/v1/business/services", token=token,
                       body={"name": "Минус", "base_price_minor": -100, "base_duration_minutes": 30})
        check(code == 422, "отрицательная цена отклонена (422)")
    finally:
        print("5. Уборка")
        code, _ = call("DELETE", f"{crm}/api/v1/business/services/{svc['id']}", token=token)
        print(f"  {'ok ' if code == 200 else 'WARN'} услуга архивирована ({code})")


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--booking", default="http://127.0.0.1:3000")
    p.add_argument("--crm", default="http://127.0.0.1:3001")
    a = p.parse_args()
    try:
        run(a.booking.rstrip("/"), a.crm.rstrip("/"))
    except SmokeFailure as e:
        print(f"FAIL {e}")
        return 1
    except (urllib.error.URLError, ConnectionError) as e:
        print(f"FAIL стек недоступен: {e}. Запустите python scripts/dev_stack.py")
        return 1
    print("SMOKE PASSED: услуга 8000 KZT видна клиенту в своём филиале")
    return 0


if __name__ == "__main__":
    sys.exit(main())
