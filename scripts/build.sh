#!/usr/bin/env bash
set -e
mkdir -p dist
babel src -d dist --source-maps --ignore "**/*.test.js" --ignore "**/__mocks__" --ignore "**/__snapshots__" --ignore "**/__tests__"
