# BZE Hub — task runner
# Usage: `make test` (Go + frontend), `make test-go`, `make test-fe`, `make help`

.DEFAULT_GOAL := test
.PHONY: test test-go test-go-race test-fe help

## test: run all tests (Go + frontend)
test: test-go test-fe

## test-go: run Go unit tests
test-go:
	@echo "==> Go tests"
	go test ./...

## test-go-race: run Go unit tests with the race detector (slower)
test-go-race:
	@echo "==> Go tests (-race)"
	go test -race ./...

## test-fe: run frontend tests (skips automatically if no test script is configured)
test-fe:
	@echo "==> Frontend tests"
	@if ! command -v npm >/dev/null 2>&1; then \
		echo "    npm not found — skipping frontend tests"; \
	elif [ "$$(cd frontend && npm pkg get scripts.test 2>/dev/null)" != "{}" ]; then \
		cd frontend && { [ -d node_modules/vitest ] || npm install; } && npm test; \
	else \
		echo "    no frontend \"test\" script yet — skipping (add one to frontend/package.json to enable)"; \
	fi

## help: list available targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //'
