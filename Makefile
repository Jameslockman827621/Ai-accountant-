.PHONY: install build dev test clean docker-up docker-down migrate seed

install:
	npm install

build:
	npm run build

dev:
	npm run dev

test:
	npm test

clean:
	npm run clean
	rm -rf node_modules

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

migrate:
	cd services/database && npm run migrate

seed:
	cd services/database && npm run seed

setup: install docker-up
	@echo "Waiting for database to be ready..."
	@sleep 5
	$(MAKE) migrate
	$(MAKE) seed
	@echo "Setup complete!"
