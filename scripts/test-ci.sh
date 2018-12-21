#!/usr/bin/env bash
set -e
jest . --runInBand --forceExit --colors
codecov
