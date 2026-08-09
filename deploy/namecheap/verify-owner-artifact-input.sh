#!/usr/bin/env bash
set -Eeuo pipefail

snapshot_regular_file() {
  local source_path=$1 destination_path=$2
  "$PYTHON" - "$source_path" "$destination_path" <<'PY'
import os
import pathlib
import shutil
import stat
import sys

source_path, destination_path = sys.argv[1:]
source_flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
if hasattr(os, "O_NOFOLLOW"):
    source_flags |= os.O_NOFOLLOW
destination_flags = (
    os.O_WRONLY
    | os.O_CREAT
    | os.O_EXCL
    | getattr(os, "O_CLOEXEC", 0)
)

try:
    source_descriptor = os.open(source_path, source_flags)
    try:
        before = os.fstat(source_descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("source is not a regular file")
        destination_descriptor = os.open(destination_path, destination_flags, 0o600)
        try:
            with os.fdopen(os.dup(source_descriptor), "rb") as source, os.fdopen(
                os.dup(destination_descriptor), "wb"
            ) as destination:
                shutil.copyfileobj(source, destination, length=1024 * 1024)
                destination.flush()
                os.fsync(destination.fileno())
            after = os.fstat(source_descriptor)
            if (
                before.st_dev,
                before.st_ino,
                before.st_size,
                before.st_mtime_ns,
            ) != (
                after.st_dev,
                after.st_ino,
                after.st_size,
                after.st_mtime_ns,
            ):
                raise ValueError("source changed while it was being snapshotted")
        finally:
            os.close(destination_descriptor)
    finally:
        os.close(source_descriptor)
except (OSError, ValueError) as error:
    print(f"ARTIFACT_SNAPSHOT_FAILED={error}", file=sys.stderr)
    raise SystemExit(1)

snapshot = pathlib.Path(destination_path)
if not snapshot.is_file() or snapshot.is_symlink():
    print("ARTIFACT_SNAPSHOT_FAILED=destination is not a regular file", file=sys.stderr)
    raise SystemExit(1)
PY
}

verify_archive_structure() {
  local archive_path=$1 artifact_root=$2 inventory_path=$3
  "$PYTHON" - "$archive_path" "$artifact_root" "$inventory_path" <<'PY'
import pathlib
import posixpath
import sys
import tarfile

archive_path, artifact_root, inventory_path = sys.argv[1:]
maximum_archive_bytes = 1024 * 1024 * 1024
maximum_members = 20000
maximum_member_name_bytes = 4096
maximum_uncompressed_bytes = 2 * 1024 * 1024 * 1024
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
    if (
        not name
        or len(name.encode("utf-8")) > maximum_member_name_bytes
        or name.startswith("/")
        or "\\" in name
    ):
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
    if pathlib.Path(archive_path).stat().st_size > maximum_archive_bytes:
        raise ValueError("archive exceeds the compressed-size limit")
    members = []
    seen = set()
    total_uncompressed_bytes = 0
    with tarfile.open(archive_path, mode="r:gz") as archive:
        inspect_headers("<global>", getattr(archive, "pax_headers", {}) or {})
        for member in archive:
            if len(members) >= maximum_members:
                raise ValueError("archive exceeds the member-count limit")
            inspect_name(member.name)
            inspect_headers(member.name, getattr(member, "pax_headers", {}) or {})
            if not (member.isfile() or member.isdir()):
                print(
                    f"FORBIDDEN_ARCHIVE_MEMBER_TYPE={member.name} type={member.type!r}",
                    file=sys.stderr,
                )
                raise SystemExit(1)
            if member.size < 0:
                raise ValueError("archive member has a negative size")
            total_uncompressed_bytes += member.size
            if total_uncompressed_bytes > maximum_uncompressed_bytes:
                raise ValueError("archive exceeds the uncompressed-size limit")
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
except (tarfile.TarError, OSError, UnicodeError, ValueError) as error:
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

verify_extracted_release_identity() {
  local release_directory=$1 artifact_root=$2
  "$PYTHON" - "$release_directory" "$artifact_root" <<'PY'
import json
import os
import pathlib
import re
import stat
import sys

release_directory = pathlib.Path(sys.argv[1])
artifact = sys.argv[2]
artifact_match = re.fullmatch(r"orderweeddc-([0-9a-f]{40})", artifact)
if artifact_match is None:
    print(
        "RELEASE_IDENTITY_VERIFICATION_FAILED=artifact name must contain exactly 40 lowercase hex characters",
        file=sys.stderr,
    )
    raise SystemExit(1)
git_sha_from_name = artifact_match.group(1)
short_sha = git_sha_from_name[:7]


def bounded_regular_text(relative_path, maximum_bytes):
    path = release_directory / relative_path
    metadata = os.lstat(path)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > maximum_bytes:
        raise ValueError(f"{relative_path} is missing, non-regular, or oversized")
    payload = path.read_bytes()
    if len(payload) > maximum_bytes or b"\0" in payload:
        raise ValueError(f"{relative_path} is not bounded text")
    return payload.decode("utf-8")


try:
    receipt = json.loads(bounded_regular_text("receipt.json", 65536))
    release = json.loads(bounded_regular_text("release.json", 65536))
    build_id = bounded_regular_text(".next/BUILD_ID", 256).strip()
    git_sha = release.get("gitSha")
    if (
        not build_id
        or release.get("artifact") != artifact
        or receipt.get("artifact") != artifact
        or not isinstance(git_sha, str)
        or re.fullmatch(r"[0-9a-f]{40}", git_sha) is None
        or git_sha != git_sha_from_name
        or receipt.get("gitSha") != git_sha
        or release.get("shortSha") != short_sha
        or release.get("bundler") != "webpack"
        or receipt.get("bundler") != "webpack"
        or receipt.get("unresolvedExternalScan", {}).get("unresolved") != []
        or receipt.get("isolatedRuntimeTest", {}).get("passed") is not True
    ):
        raise ValueError("release identity fields are inconsistent")
except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as error:
    print(f"RELEASE_IDENTITY_VERIFICATION_FAILED={error}", file=sys.stderr)
    raise SystemExit(1)
PY
}

verify_owner_artifact_inputs() {
  local artifact_actual_sha sidecar_actual_sha
  local inventory release_file build_id_file source_artifact snapshot_artifact
  [ -f "$ARTIFACT_PATH" ] && [ ! -L "$ARTIFACT_PATH" ] || return 1
  [ -f "$ARTIFACT_SIDECAR_PATH" ] && [ ! -L "$ARTIFACT_SIDECAR_PATH" ] || return 1
  source_artifact=$ARTIFACT_PATH
  snapshot_artifact="$STATE_ROOT/verified-artifact.tar.gz"
  snapshot_regular_file "$source_artifact" "$snapshot_artifact" || return 1
  ARTIFACT_PATH=$snapshot_artifact
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
  if [ "${1-}" = --verify-extracted-identity ]; then
    [ "$#" -eq 3 ] || {
      printf 'usage: %s --verify-extracted-identity <release-directory> <root>\n' "$0" >&2
      return 64
    }
    PYTHON=$(command -v python3 || true)
    [ -n "$PYTHON" ] || {
      printf 'RELEASE_IDENTITY_VERIFICATION=FAIL reason=PYTHON3_UNAVAILABLE\n' >&2
      return 1
    }
    verify_extracted_release_identity "$2" "$3" || return 1
    printf 'RELEASE_IDENTITY_VERIFICATION=PASS\n'
    return 0
  fi
  if [ "${1-}" = --snapshot-structure-only ]; then
    [ "$#" -eq 6 ] || {
      printf 'usage: %s --snapshot-structure-only <archive> <archive-sha256> <root> <snapshot> <inventory>\n' "$0" >&2
      return 64
    }
    PYTHON=$(command -v python3 || true)
    [ -n "$PYTHON" ] || {
      printf 'STRUCTURAL_ARCHIVE_VERIFICATION=FAIL reason=PYTHON3_UNAVAILABLE\n' >&2
      return 1
    }
    snapshot_regular_file "$2" "$5" || return 1
    [ "$(sha256sum "$5" | awk '{print $1}')" = "$3" ] || {
      printf 'ARTIFACT_SNAPSHOT_SHA256_MISMATCH\n' >&2
      return 1
    }
    verify_archive_structure "$5" "$4" "$6" || return 1
    printf 'IMMUTABLE_ARTIFACT_SNAPSHOT=PASS\n'
    printf 'STRUCTURAL_ARCHIVE_VERIFICATION=PASS\n'
    return 0
  fi
  if [ "${1-}" = --structure-only ]; then
    [ "$#" -eq 4 ] || {
      printf 'usage: %s --structure-only <archive> <root> <inventory>\n' "$0" >&2
      return 64
    }
    PYTHON=$(command -v python3 || true)
    [ -n "$PYTHON" ] || {
      printf 'STRUCTURAL_ARCHIVE_VERIFICATION=FAIL reason=PYTHON3_UNAVAILABLE\n' >&2
      return 1
    }
    verify_archive_structure "$2" "$3" "$4" || return 1
    printf 'STRUCTURAL_ARCHIVE_VERIFICATION=PASS\n'
    return 0
  fi
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
