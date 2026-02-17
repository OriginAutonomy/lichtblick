#!/bin/bash

LICHTBLICK_DIR="/root/lichtblick"

cd "$LICHTBLICK_DIR" || {
    echo "ERROR: Failed to change to directory: $LICHTBLICK_DIR"
    exit 1
}

source ~/.bashrc

echo "Starting server on port 8017..."
exec yarn web:serve:instant

