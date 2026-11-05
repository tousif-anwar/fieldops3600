"""Convert actual role recordings to portable H.264 MP4 and validate decoding.

Requires the workspace-local imageio_ffmpeg tools used for the presentation.
Calls the absolute encoder directly and never changes PATH or original WebM files.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / ".tools/presentation-python"
sys.path.insert(0, str(TOOLS))
import imageio_ffmpeg

ENCODER = Path(imageio_ffmpeg.get_ffmpeg_exe()).resolve(strict=True)
if ROOT not in ENCODER.parents:
    raise RuntimeError("Use the installed workspace-local absolute encoder")
FOLDER = ROOT / "docs/presentation/demos/web"
PRIVATE = ROOT / ".local/web-media-build"
ORDER = ["dispatcher", "technician", "supervisor", "manager", "analyst", "administrator"]
PRIVATE.mkdir(parents=True, exist_ok=True)


def run(arguments, *, check=True):
    result = subprocess.run([str(ENCODER), *arguments], capture_output=True,
                            text=True, encoding="utf-8", errors="replace",
                            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
    if check and result.returncode:
        raise RuntimeError("Encoder failed: " + result.stderr[-2400:])
    return result


def info(path):
    result = run(["-hide_banner", "-i", str(path)], check=False)
    line = next((line for line in result.stderr.splitlines() if "Stream #" in line and "Video:" in line), "")
    codec = re.search(r"Video:\s*([^ ,(]+)", line)
    size = re.search(r"(?<!\d)(\d{3,5})x(\d{3,5})(?!\d)", line)
    duration = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    fps = re.search(r"(\d+(?:\.\d+)?) fps", line)
    if not codec or not size or not duration:
        raise RuntimeError("Unable to read actual media metadata for " + path.name)
    hours, minutes, seconds = map(float, duration.groups())
    return {"codec": codec.group(1), "width": int(size.group(1)), "height": int(size.group(2)),
            "containerDurationSeconds": hours * 3600 + minutes * 60 + seconds,
            "fps": float(fps.group(1)) if fps else None, "yuv420p": "yuv420p" in line,
            "audioStreams": sum("Stream #" in line and "Audio:" in line for line in result.stderr.splitlines())}


def validate(path):
    metadata = info(path)
    result = run(["-hide_banner", "-v", "error", "-xerror", "-i", str(path),
                  "-map", "0:v:0", "-an", "-f", "null", "-", "-progress", "pipe:1", "-nostats"])
    frames = re.findall(r"(?m)^frame=(\d+)$", result.stdout)
    if not frames:
        raise RuntimeError("No decoded frames for " + path.name)
    count = int(frames[-1])
    if metadata["codec"] != "h264" or metadata["width"] != 1920 or metadata["height"] != 1080:
        raise RuntimeError("Unexpected output codec or dimensions")
    if not metadata["yuv420p"] or metadata["fps"] != 30 or metadata["audioStreams"] != 0 or count < 1:
        raise RuntimeError("Unexpected output pixel format, rate, audio or empty video")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    atoms = {}
    with path.open("rb") as source:
        while source.tell() < path.stat().st_size:
            offset = source.tell()
            header = source.read(8)
            if len(header) != 8:
                break
            size, kind = struct.unpack(">I4s", header)
            if size == 1:
                size = struct.unpack(">Q", source.read(8))[0]
            if size == 0:
                size = path.stat().st_size - offset
            if size < 8:
                raise RuntimeError("Invalid MP4 atom")
            atoms[kind.decode("ascii", errors="replace")] = offset
            source.seek(offset + size)
    if not ("moov" in atoms and "mdat" in atoms and atoms["moov"] < atoms["mdat"]):
        raise RuntimeError("MP4 does not have verified fast-start atom order")
    return {**metadata, "decodedFrames": count, "decodedDurationSeconds": round(count / 30, 6),
            "fullDecodePassed": True, "decodeErrors": [], "fastStartAtomOrderVerified": True,
            "bytes": path.stat().st_size, "sha256": digest}


def encode(role):
    source = FOLDER / (role + "-walkthrough.webm")
    target = FOLDER / (role + "-walkthrough.mp4")
    source_metadata = info(source)
    log = PRIVATE / (role + ".encode.log")
    if not target.exists():
        result = run(["-hide_banner", "-y", "-i", str(source), "-map", "0:v:0", "-an",
                      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
                      "-r", "30", "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "veryfast",
                      "-crf", "26", "-pix_fmt", "yuv420p", "-profile:v", "high", "-threads", "2",
                      "-movflags", "+faststart", "-metadata", "title=FieldOps 360: " + role,
                      "-metadata", "comment=Silent actual served application recording; synthetic data",
                      str(target)])
        log.write_text(result.stderr, encoding="utf-8")
    verified = validate(target)
    print(json.dumps({"role": role, "seconds": verified["decodedDurationSeconds"],
                      "megabytes": round(verified["bytes"] / 1_000_000, 2), "fullDecodePassed": True}), flush=True)
    return {"role": role, "file": target.name, "source": source.name,
            "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "sourceMetadata": source_metadata, "video": verified}


def main():
    manifest = json.loads((FOLDER / "recording-manifest.json").read_text("utf-8"))
    for role in ORDER:
        entry = next(item for item in manifest["roles"] if item["role"] == role)
        if not entry["ok"] or entry["errors"]:
            raise RuntimeError("Capture manifest contains an incomplete role: " + role)
    with ThreadPoolExecutor(max_workers=2) as pool:
        clips = list(pool.map(encode, ORDER))
    listing = PRIVATE / "concat.txt"
    listing.write_text("\n".join("file '" + str((FOLDER / clip["file"]).resolve()).replace("\\", "/").replace("'", "'\\''") + "'" for clip in clips) + "\n", encoding="utf-8")
    chapters = PRIVATE / "chapters.ffmetadata"
    lines = [";FFMETADATA1", "title=FieldOps 360 complete web walkthrough",
             "comment=Silent actual software recording with synthetic data"]
    elapsed = 0
    chapter_records = []
    for clip in clips:
        start = elapsed
        elapsed += clip["video"]["decodedFrames"]
        first_ms, last_ms = round(start * 1000 / 30), round(elapsed * 1000 / 30)
        lines += ["[CHAPTER]", "TIMEBASE=1/1000", "START=" + str(first_ms),
                  "END=" + str(last_ms), "title=" + clip["role"].title()]
        chapter_records.append({"role": clip["role"], "startSeconds": round(start / 30, 6),
                                "endSeconds": round(elapsed / 30, 6)})
    chapters.write_text("\n".join(lines) + "\n", encoding="utf-8")
    complete = FOLDER / "complete-web-walkthrough.mp4"
    if not complete.exists():
        run(["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
             "-f", "ffmetadata", "-i", str(chapters), "-map", "0:v:0",
             "-map_metadata", "1", "-map_chapters", "1", "-an", "-c:v", "copy",
             "-movflags", "+faststart", str(complete)])
    combined = validate(complete)
    if combined["bytes"] >= 90_000_000:
        raise RuntimeError("Combined walkthrough exceeds the 90 MB target")
    if abs(combined["decodedFrames"] - elapsed) > 2:
        raise RuntimeError("Combined frame count does not match ordered source clips")
    chapter_info = run(["-hide_banner", "-i", str(complete)], check=False).stderr
    actual_chapters = re.findall(
        r"Chapter #\d+:\d+: start ([\d.]+), end ([\d.]+)\s*\n\s*Metadata:\s*\n\s*title\s*:\s*(.+)",
        chapter_info,
    )
    if len(actual_chapters) != len(chapter_records):
        raise RuntimeError("Combined MP4 chapter metadata is missing")
    for actual, expected in zip(actual_chapters, chapter_records, strict=True):
        if (abs(float(actual[0]) - expected["startSeconds"]) > 0.002
                or abs(float(actual[1]) - expected["endSeconds"]) > 0.002
                or actual[2].strip().lower() != expected["role"]):
            raise RuntimeError("Combined MP4 chapter metadata does not match the role sequence")
    result = {"validatedAtUtc": datetime.now(timezone.utc).isoformat(), "synthetic": True,
              "sourceCaptureManifest": "recording-manifest.json",
              "encoder": run(["-version"]).stdout.splitlines()[0],
              "method": "Direct absolute workspace-local FFmpeg; metadata read plus complete frame decode",
              "encoding": {"codec": "H.264 / libx264", "crf": 26, "fps": 30, "pixelFormat": "yuv420p",
                           "dimensions": "1920x1080", "aspectRatioPreserved": True, "silent": True,
                           "fastStart": True, "playbackSpeedChanged": False},
              "clips": clips, "combined": {"file": complete.name, "video": combined,
                                         "chapterMetadataVerified": True,
                                         "chapters": chapter_records},
              "captureErrors": [], "originalWebmFilesPreserved": True,
              "limits": ["Silent recordings require the presenter script for narration.",
                         "A recorded page visit is not proof of every feature on that page.",
                         "Web recording does not substitute for native Android evidence."]}
    (FOLDER / "MEDIA_VALIDATION.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"combinedSeconds": combined["decodedDurationSeconds"],
                      "combinedMegabytes": round(combined["bytes"] / 1_000_000, 2),
                      "fullDecodePassed": True, "output": complete.name}), flush=True)


if __name__ == "__main__":
    main()

