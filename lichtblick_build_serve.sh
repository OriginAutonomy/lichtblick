#!/bin/bash

# Lichtblick build and serve script
# - Always serves (existing or new build)
# - Only builds if git pull is successful AND brings changes

LICHTBLICK_DIR="/root/lichtblick"

cd "$LICHTBLICK_DIR" || {
    echo "ERROR: Failed to change to directory: $LICHTBLICK_DIR"
    exit 1
}
source ~/.bashrc

# Check if this is a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "WARNING: Not a git repository, skipping git pull and build"
    HAS_CHANGES=false
    GIT_PULL_SUCCESS=true
else
    # Store current HEAD commit hash before git pull
    BEFORE_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")

    # Perform git pull and capture success
    echo "Checking for updates..."
    GIT_PULL_SUCCESS=false

    # Properly capture git pull exit code
    if git pull; then
        GIT_PULL_SUCCESS=true
        echo "Git pull completed successfully"
    else
        echo "WARNING: git pull failed (exit code $?)"
        echo "Skipping build, serving existing build..."
    fi

    # Check if there are changes by comparing commit hashes
    # Only check if pull was successful
    HAS_CHANGES=false

    if [ "$GIT_PULL_SUCCESS" = true ]; then
        AFTER_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")

        if [ -n "$BEFORE_COMMIT" ] && [ -n "$AFTER_COMMIT" ] && [ "$BEFORE_COMMIT" != "$AFTER_COMMIT" ]; then
            HAS_CHANGES=true
            echo "Changes detected: $BEFORE_COMMIT -> $AFTER_COMMIT"
        else
            echo "No changes detected (already up to date)"
        fi
    fi
fi

# Only build if pull was successful AND there are changes
if [ "$GIT_PULL_SUCCESS" = true ] && [ "$HAS_CHANGES" = true ]; then
    echo "Building yarn web:build:prod with resource constraints..."

    export NODE_OPTIONS="--max-old-space-size=512"

    BUILD_SUCCESS=false
    if command -v taskset > /dev/null 2>&1; then
        if nice -n 19 yarn web:build:prod 2>/dev/null; then
            BUILD_SUCCESS=true
        fi
    else
        if nice -n 19 yarn web:build:prod; then
            BUILD_SUCCESS=true
        fi
    fi

    if [ "$BUILD_SUCCESS" = true ]; then
        echo "Build completed successfully"
    else
        echo "WARNING: Build failed, serving existing build"
    fi
else
    if [ "$GIT_PULL_SUCCESS" = false ]; then
        echo "Skipping build: git pull failed"
    elif [ "$HAS_CHANGES" = false ]; then
        echo "Skipping build: no changes detected"
    fi
fi

# Always serve (whether pull succeeded/failed, whether build ran/not)
echo "Starting yarn web:serve:instant..."
exec yarn web:serve:instant
