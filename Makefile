.PHONY: rebuild down up

rebuild_v:
	docker compose down -v
	docker compose up -d --build
rebuild:
	docker compose down
	docker compose up -d --build


down:
	docker compose down

up:
	docker compose up -d --build
