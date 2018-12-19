#!/usr/bin/env bash
rm -rf dist
mkdir -p dist
babel -w src -d dist --source-maps --ignore "**/*.test.js" --ignore "**/__mocks__" --ignore "**/__snapshots__" --ignore "**/__tests__"
