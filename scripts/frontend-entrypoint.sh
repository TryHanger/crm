#!/bin/sh
set -eu

SYNC_MODE="${FRONTEND_SYNC_MODE:-strict}"

copy_tree() {
    src="$1"
    dst="$2"
    find "$src" -type d | while IFS= read -r src_dir; do
        rel="${src_dir#"$src"}"
        rel="${rel#/}"
        if [ -n "$rel" ] && [ ! -d "$dst/$rel" ]; then
            mkdir -p "$dst/$rel"
            chmod 0755 "$dst/$rel"
        fi
    done || exit 1

    find "$src" -type f | while IFS= read -r src_file; do
        rel="${src_file#"$src"/}"
        cp -f "$src_file" "$dst/$rel"
        chmod 0644 "$dst/$rel"
    done || exit 1
}

sync_app() {
    app="$1"
    src="/opt/static/$app"
    dst="/var/www/$app"

    if [ ! -d "$src" ]; then
        echo "ERROR: [$app] Missing source static directory $src" >&2
        exit 1
    fi

    if [ ! -d "$dst" ]; then
        mkdir -p "$dst"
    fi

    # Empty destination volume: initial population
    if [ -z "$(ls -A "$dst" 2>/dev/null)" ]; then
        echo "[$app] Empty target volume; initializing from $src..."
        copy_tree "$src" "$dst"
        return 0
    fi

    # Explicit replace mode: wipe old assets before copying new build to prevent version mixing
    if [ "$SYNC_MODE" = "replace" ]; then
        echo "[$app] FRONTEND_SYNC_MODE=replace; replacing target volume contents cleanly..."
        find "$dst" -mindepth 1 -delete
        copy_tree "$src" "$dst"
        return 0
    fi

    if [ "$SYNC_MODE" != "strict" ]; then
        echo "ERROR: [$app] Unsupported FRONTEND_SYNC_MODE='$SYNC_MODE' (expected 'strict' or 'replace')." >&2
        exit 1
    fi

    # Strict mode (default): idempotent check; refuse silent overwrite or version mixing
    if [ ! -f "$dst/index.html" ]; then
        echo "ERROR: [$app] Target $dst is non-empty but missing index.html; refusing silent overwrite (set FRONTEND_SYNC_MODE=replace to replace)." >&2
        exit 1
    fi

    if ! cmp -s "$src/index.html" "$dst/index.html"; then
        echo "ERROR: [$app] Existing $dst/index.html differs from image build; refusing silent overwrite or asset mixing (set FRONTEND_SYNC_MODE=replace to upgrade cleanly)." >&2
        exit 1
    fi

    find "$src" -type f | while IFS= read -r src_file; do
        rel="${src_file#"$src"/}"
        dst_file="$dst/$rel"
        dst_dir="$(dirname "$dst_file")"
        if [ ! -d "$dst_dir" ]; then
            mkdir -p "$dst_dir"
            chmod 0755 "$dst_dir"
        fi
        if [ -e "$dst_file" ]; then
            if ! cmp -s "$src_file" "$dst_file"; then
                echo "ERROR: [$app] Existing file $dst_file differs from image build; refusing silent overwrite (set FRONTEND_SYNC_MODE=replace to upgrade cleanly)." >&2
                exit 1
            fi
        else
            cp -f "$src_file" "$dst_file"
            chmod 0644 "$dst_file"
        fi
    done || exit 1

    echo "[$app] Volume already matches image assets; skipped overwrite."
}

sync_app "booking-web"
sync_app "business-crm"
sync_app "platform-console"

echo "Frontend assets synchronized successfully"
exec sleep infinity
