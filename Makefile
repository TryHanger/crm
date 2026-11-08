.PHONY: help init-db test run up down logs shell

help:
	@echo "Available commands:"
	@echo "  make up       - Start all containers via docker-compose"
	@echo "  make down     - Stop and remove containers"
	@echo "  make logs     - Follow container logs"
	@echo "  make init-db  - Initialize extensions, RLS, and seed data"
	@echo "  make test     - Run full test suite with pytest"
	@echo "  make run      - Run local development server"

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

init-db:
	python -m apps.api.app.infrastructure.db.init_db

test:
	pytest apps/api/tests/ -v

run:
	uvicorn apps.api.app.main:app --reload --port 8000
