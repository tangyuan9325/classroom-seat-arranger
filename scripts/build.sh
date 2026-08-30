#!/usr/bin/env bash
# 一键交叉编译 Windows / Linux / macOS
export GOPATH=/home/user/.super_doubao/super-doubao-runtime/workspace/gopath
set -e
cd "$(dirname "$0")/.."
mkdir -p bin
FLAGS="-s -w"
echo "==> 编译 Windows x64 .exe"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$FLAGS" -o "bin/班级排座位-Windows-x64.exe" .
echo "==> 编译 Linux amd64"
GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$FLAGS" -o "bin/seat-arranger-linux-amd64" .
echo "==> 编译 macOS amd64"
GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$FLAGS" -o "bin/seat-arranger-macos-amd64" .
ls -lh bin/
