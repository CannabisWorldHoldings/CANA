#!/usr/bin/env bash
set -Eeuo pipefail

verify_archive_structure() {
  local archive_path=$1 artifact_root=$2 inventory_path=$3
  "$PYTHON" - "$archive_path" "$artifact_root" "$inventory_path" <<'PY'
import pathlib
import posixpath
import sys
import tarfile

archive_path, artifact_root, inventory_path = sys.argv[1:]
forbidden_key_prefixes = ("LIBARCHIVE.xattr.", "SCHILY.xattr.")
forbidden_tokens = (
    "com.apple.provenance",
    "com.apple.ResourceFork",
    "com.apple.FinderInfo",
)
required_members = {
    f"{artifact_root}/deploy.sh",
    f"{artifact_root}/release.json",
    f"{artifact_root}/.next/BUILD_ID",
}


def inspect_headers(location, headers):
    for key, value in (headers or {}).items():
        key_text = str(key)
        record = f"{key_text}={value}"
        if key_text.startswith(forbidden_key_prefixes):
            print(
                f"FORBIDDEN_PAX_HEADER location={location} key={key_text}",
                file=sys.stderr,
            )
            raise SystemExit(1)
        if any(token in record for token in forbidden_tokens):
            print(
                f"FORBIDDEN_MACOS_METADATA location={location} key={key_text}",
                file=sys.stderr,
            )
            raise SystemExit(1)


def inspect_name(name):
    if not name or name.startswith("/") or "\\" in name:
        print(f"UNSAFE_ARCHIVE_MEMBER={name}", file=sys.stderr)
        raise SystemExit(1)
    normalized = posixpath.normpath(name)
    if normalized != name.rstrip("/") or normalized in (".", ".."):
        print(f"UNSAFE_ARCHIVE_MEMBER={name}", file=sys.stderr)
        raise SystemExit(1)
    parts = tuple(part for part in normalized.split("/") if part)
    if any(part == ".." for part in parts):
        print(f"UNSAFE_ARCHIVE_MEMBER={name}", file=sys.stderr)
        raise SystemExit(1)
    if any(
        part.startswith("._")
        or part in (".DS_Store", "__MACOSX", ".AppleDouble", "..namedfork")
        for part in parts
    ):
        print(f"FORBIDDEN_MACOS_MEMBER={name}", file=sys.stderr)
        raise SystemExit(1)


try:
    members = []
    seen = set()
    with tarfile.open(archive_path, mode="r:gz") as archive:
        inspect_headers("<global>", getattr(archive, "pax_headers", {}) or {})
        for member in archive:
            inspect_name(member.name)
            inspect_headers(member.name, getattr(member, "pax_headers", {}) or {})
            normalized = member.name.rstrip("/")
            if normalized != artifact_root and not normalized.startswith(f"{artifact_root}/"):
                print(f"UNEXPECTED_ARCHIVE_ROOT={normalized}", file=sys.stderr)
                raise SystemExit(1)
            if normalized in seen:
                print(f"DUPLICATE_ARCHIVE_MEMBER={normalized}", file=sys.stderr)
                raise SystemExit(1)
            seen.add(normalized)
            members.append(member.name)
        missing = sorted(required_members - seen)
        if missing:
            print(f"REQUIRED_ARCHIVE_MEMBERS_MISSING={','.join(missing)}", file=sys.stderr)
            raise SystemExit(1)
        for required in required_members:
            member = archive.getmember(required)
            if not member.isfile():
                print(f"REQUIRED_ARCHIVE_MEMBER_NOT_REGULAR={required}", file=sys.stderr)
                raise SystemExit(1)
    pathlib.Path(inventory_path).write_text("\n".join(members) + "\n", encoding="utf-8")
except (tarfile.TarError, OSError, UnicodeError) as error:
    print(f"ARCHIVE_HEADER_INSPECTION_FAILED={error}", file=sys.stderr)
    raise SystemExit(1)
PY
}

extract_bounded_text_member() {
  local archive_path=$1 member_name=$2 destination=$3 maximum_bytes=$4
  "$PYTHON" - "$archive_path" "$member_name" "$destination" "$maximum_bytes" <<'PY'
import os
import pathlib
import sys
import tarfile

archive_path, member_name, destination, maximum_bytes = sys.argv[1:]
maximum_bytes = int(maximum_bytes)
try:
    with tarfile.open(archive_path, mode="r:gz") as archive:
        matches = [member for member in archive if member.name.rstrip("/") == member_name]
        if len(matches) != 1 or not matches[0].isfile() or matches[0].size > maximum_bytes:
            raise ValueError("member is missing, duplicated, non-regular, or oversized")
        source = archive.extractfile(matches[0])
        if source is None:
            raise ValueError("member cannot be read")
        payload = source.read(maximum_bytes + 1)
        if len(payload) > maximum_bytes or b"\0" in payload:
            raise ValueError("member is not bounded text")
        payload.decode("utf-8")
    output = pathlib.Path(destination)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
except (OSError, UnicodeError, ValueError, tarfile.TarError) as error:
    print(f"BOUNDED_TEXT_EXTRACTION_FAILED member={member_name} error={error}", file=sys.stderr)
    raise SystemExit(1)
PY
}

bounded_text_file_matches() {
  local file=$1 expected=$2
  "$PYTHON" - "$file" "$expected" <<'PY'
import pathlib
import sys

actual = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
if actual.rstrip("\r\n") != sys.argv[2]:
    raise SystemExit(1)
PY
}

json_release_matches() {
  local file=$1 commit=$2 artifact=$3
  "$PYTHON" - "$file" "$commit" "$artifact" <<'PY'
import json
import pathlib
import sys

value = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if value.get("gitSha") != sys.argv[2] or value.get("artifact") != sys.argv[3]:
    raise SystemExit(1)
PY
}

verify_owner_artifact_inputs() {
  local artifact_actual_sha sidecar_actual_sha
  local inventory release_file build_id_file
  [ -f "$ARTIFACT_PATH" ] && [ ! -L "$ARTIFACT_PATH" ] || return 1
  [ -f "$ARTIFACT_SIDECAR_PATH" ] && [ ! -L "$ARTIFACT_SIDECAR_PATH" ] || return 1
  artifact_actual_sha=$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}') || return 1
  [ "$artifact_actual_sha" = "$ARTIFACT_SHA" ] || return 1
  sidecar_actual_sha=$(sha256sum "$ARTIFACT_SIDECAR_PATH" | awk '{print $1}') || return 1
  [ "$sidecar_actual_sha" = "$ARTIFACT_SIDECAR_SHA" ] || return 1
  (cd "$UPLOADS" && sha256sum -c "$ARTIFACT_SIDECAR_NAME") || return 1

  inventory="$STATE_ROOT/artifact-members.txt"
  release_file="$STATE_ROOT/artifact-release.json"
  build_id_file="$STATE_ROOT/artifact-build-id.txt"
  verify_archive_structure "$ARTIFACT_PATH" "$ARTIFACT_ROOT_NAME" "$inventory" || return 1
  extract_bounded_text_member \
    "$ARTIFACT_PATH" "$ARTIFACT_ROOT_NAME/release.json" "$release_file" 65536 || return 1
  json_release_matches "$release_file" "$CANONICAL_COMMIT" "$ARTIFACT_ROOT_NAME" || return 1
  extract_bounded_text_member \
    "$ARTIFACT_PATH" "$ARTIFACT_ROOT_NAME/.next/BUILD_ID" "$build_id_file" 256 || return 1
  bounded_text_file_matches "$build_id_file" "$CANONICAL_BUILD_ID"
}

owner_artifact_input_main() {
  [ "$#" -eq 8 ] || {
    printf 'usage: %s <archive> <archive-sha256> <sidecar> <sidecar-sha256> <root> <commit> <build-id> <state-root>\n' "$0" >&2
    return 64
  }
  ARTIFACT_PATH=$1
  ARTIFACT_SHA=$2
  ARTIFACT_SIDECAR_PATH=$3
  ARTIFACT_SIDECAR_SHA=$4
  ARTIFACT_ROOT_NAME=$5
  CANONICAL_COMMIT=$6
  CANONICAL_BUILD_ID=$7
  STATE_ROOT=$8
  UPLOADS=$(dirname "$ARTIFACT_PATH")
  ARTIFACT_NAME=$(basename "$ARTIFACT_PATH")
  ARTIFACT_SIDECAR_NAME=$(basename "$ARTIFACT_SIDECAR_PATH")
  PYTHON=$(command -v python3 || true)
  [ -n "$PYTHON" ] || {
    printf 'COURT_STATUS=FAIL\nFAILURE_REASON=PYTHON3_UNAVAILABLE\nDEPLOYMENT_STARTED=NO\nAUTOMATIC_ROLLBACK_EXECUTED=NO\n' >&2
    return 1
  }
  mkdir -p "$STATE_ROOT" || return 1
  chmod 700 "$STATE_ROOT" || return 1
  if ! verify_owner_artifact_inputs; then
    printf 'COURT_STATUS=FAIL\nFAILURE_REASON=CANONICAL_ARTIFACT_INPUT_VERIFICATION_FAILED\nDEPLOYMENT_STARTED=NO\nAUTOMATIC_ROLLBACK_EXECUTED=NO\n' >&2
    return 1
  fi
  printf 'STRUCTURAL_PAX_HEADER_AUDIT=PASS\n'
  printf 'BINARY_SAFE_ARCHIVE_INPUT_GATE=PASS\n'
  printf 'ARTIFACT_INPUT_VERIFICATION=PASS\n'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  owner_artifact_input_main "$@"
fi
