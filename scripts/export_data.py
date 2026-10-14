"""Export the local TalkEval artifacts as a browser-only public snapshot."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


DEMO_ROOT = Path(__file__).resolve().parents[2]
INPUT_ROOT = DEMO_ROOT / "real_data" / "incoming"
OUTPUT_ROOT = DEMO_ROOT / "artifacts" / "real-batch"
DIST_ROOT = Path(__file__).resolve().parents[1] / "dist"
DOCS_ROOT = Path(__file__).resolve().parents[1] / "docs"
VIDEO_RELEASE_URL = (
    "https://github.com/YuhanHao0126/talkeval-speech-review"
    "/releases/download/talkeval-videos-v1"
)
VIDEO_ASSETS = {
    "speech_001_ai_work": "speech_001_ai_work.mp4",
    "speech_002_pressure_white_hair": "speech_002_pressure_white_hair.mp4",
    "speech_003_college_students": "speech_003_college_students.mp4",
    "speech_004_whales": "speech_004_whales.mp4",
    "speech_005_climate": "speech_005_climate.mp4",
}
SOURCE_PAGES = {
    "speech_auto_1fbefa7db3": "https://yixi.tv/h5/speech/1419/",
    "speech_auto_594f9836f9": "https://yixi.tv/h5/speech/1447/",
    "speech_auto_65540d2c8f": "https://yixi.tv/h5/speech/1333/",
    "speech_auto_7e27718c13": "https://m.huxiu.com/article/4896342.html",
    "speech_auto_c2c143e546": "https://www.toutiao.com/article/7687871927624466963/",
}
SOURCE_PAGE_LABELS = {
    "speech_auto_1fbefa7db3": "打开一席原视频页 ↗",
    "speech_auto_594f9836f9": "打开一席原视频页 ↗",
    "speech_auto_65540d2c8f": "打开一席原视频页 ↗",
    "speech_auto_7e27718c13": "打开演讲来源页 ↗",
    "speech_auto_c2c143e546": "打开演讲来源页 ↗",
}

ARTIFACTS = {
    "intent_map": "intent_map.json",
    "expression_map": "expression_map.json",
    "alignment": "alignment.json",
    "asr": "asr.json",
    "run_metadata": "run_metadata.json",
}

VIDEO_ENCODING_PROFILE = "h264-720p-16fps-crf37-aac48-hls60-v6"


def read_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def verdict_counts(alignment: dict[str, object]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for decision in alignment.get("decisions", []):
        if isinstance(decision, dict):
            verdict = str(decision.get("verdict", "unknown"))
            counts[verdict] = counts.get(verdict, 0) + 1
    return counts


def public_metadata(metadata: dict[str, object]) -> dict[str, object]:
    """Keep useful provenance without publishing local paths or permission notes."""
    safe = {
        key: value
        for key, value in metadata.items()
        if key not in {
            "source_video_path",
            "source_script_path",
            "source_caption_path",
            "source_video_mtime_ns",
            "permission_evidence",
            "public_video_permission_evidence",
            "public_video_allowed",
        }
    }
    script_path = metadata.get("source_script_path")
    if isinstance(script_path, str) and script_path:
        safe["source_script_name"] = Path(script_path).name
    elif metadata.get("script_file"):
        safe["source_script_name"] = Path(str(metadata["script_file"])).name
    safe["permission_verified"] = bool(
        metadata.get("usage_permission") in {"analysis", "training"}
        and str(metadata.get("permission_evidence") or "").strip()
    )
    safe["public_video_playback_enabled"] = bool(
        metadata.get("public_video_allowed")
        and str(metadata.get("public_video_permission_evidence") or "").strip()
    )
    return safe


def prepare_public_video(case_id: str, source: Path) -> str:
    """Create clear, seekable HLS playback segments without changing the source."""
    output_dir = DIST_ROOT / "media" / case_id
    playlist = output_dir / "index.m3u8"
    profile_file = OUTPUT_ROOT / f".{case_id}.public-video-profile"
    output_dir.mkdir(parents=True, exist_ok=True)
    profile_matches = (
        profile_file.is_file()
        and profile_file.read_text(encoding="utf-8").strip() == VIDEO_ENCODING_PROFILE
    )
    if (
        profile_matches
        and playlist.is_file()
        and playlist.stat().st_mtime_ns >= source.stat().st_mtime_ns
    ):
        return f"./media/{case_id}/index.m3u8"

    for old_output in output_dir.iterdir():
        if old_output.is_dir():
            shutil.rmtree(old_output)
        else:
            old_output.unlink()

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("ffmpeg is required to prepare public playback videos")
    command = [
        ffmpeg,
        "-v", "error",
        "-i", os.fspath(source),
        "-map", "0:v:0",
        "-map", "0:a?",
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=16",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "37",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-ac", "2",
        "-b:a", "48k",
        "-g", "160",
        "-keyint_min", "160",
        "-sc_threshold", "0",
        "-f", "hls",
        "-hls_time", "60",
        "-hls_playlist_type", "vod",
        "-hls_segment_type", "mpegts",
        "-hls_flags", "independent_segments",
        "-hls_segment_filename", os.fspath(output_dir / "segment_%03d.ts"),
        "-y", os.fspath(playlist),
    ]
    subprocess.run(command, check=True)
    profile_file.write_text(VIDEO_ENCODING_PROFILE + "\n", encoding="utf-8")
    return f"./media/{case_id}/index.m3u8"


def mirror_dist_to_docs() -> None:
    """Keep the GitHub Pages copy in sync with the public Site snapshot."""
    DOCS_ROOT.mkdir(parents=True, exist_ok=True)
    docs_media = DOCS_ROOT / "media"
    if docs_media.exists():
        shutil.rmtree(docs_media)
    if (DIST_ROOT / "media").is_dir():
        shutil.copytree(DIST_ROOT / "media", docs_media)
    for path in DIST_ROOT.rglob("*"):
        if path.is_dir() or path.is_relative_to(DIST_ROOT / "media"):
            continue
        relative = path.relative_to(DIST_ROOT)
        destination = DOCS_ROOT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)


def main() -> None:
    cases: list[dict[str, object]] = []
    case_output = DIST_ROOT / "data" / "cases"
    report_output = DIST_ROOT / "reports"
    case_output.mkdir(parents=True, exist_ok=True)
    report_output.mkdir(parents=True, exist_ok=True)
    public_media_ids: set[str] = set()

    for result_dir in sorted(path for path in OUTPUT_ROOT.iterdir() if path.is_dir()):
        case_id = result_dir.name
        metadata_path = INPUT_ROOT / case_id / "metadata.json"
        if not metadata_path.is_file():
            continue
        metadata = read_json(metadata_path)
        detail = {
            name: read_json(result_dir / filename)
            for name, filename in ARTIFACTS.items()
        }
        if (
            metadata.get("usage_permission") in {"analysis", "training"}
            and str(metadata.get("permission_evidence") or "").strip()
        ):
            for name, filename in {
                "visual_observations": "visual_observations.json",
                "slide_analysis": "slide_analysis.json",
            }.items():
                artifact_path = result_dir / filename
                if artifact_path.is_file():
                    detail[name] = read_json(artifact_path)
        intent = detail["intent_map"]
        alignment = detail["alignment"]
        video_asset = VIDEO_ASSETS.get(case_id)
        public_playback = bool(
            metadata.get("public_video_allowed")
            and str(metadata.get("public_video_permission_evidence") or "").strip()
        )
        local_video = INPUT_ROOT / case_id / "video.mp4"
        if video_asset:
            video_url = f"{VIDEO_RELEASE_URL}/{video_asset}"
            video_format = "mp4"
        elif public_playback and local_video.is_file():
            video_url = prepare_public_video(case_id, local_video)
            video_format = "hls"
            public_media_ids.add(case_id)
        else:
            video_url = None
            video_format = None
        source_page_url = SOURCE_PAGES.get(case_id)
        script_source = metadata.get("script_source")
        review_label = (
            "文稿已匹配"
            if script_source == "provided_script_or_outline"
            else "视频字幕已匹配"
            if script_source in {"sidecar_captions", "embedded_video_subtitles"}
            else "无讲稿 · 转写提取"
            if script_source == "faster_whisper_transcription"
            else "无讲稿 · 转写提取"
            if metadata.get("script_type") == "transcript_proxy"
            else "参考文稿代理"
            if metadata.get("script_type") == "reference_script_proxy"
            else "来源待确认"
        )
        cases.append(
            {
                "case_id": case_id,
                "title": intent.get("title", metadata.get("topic", case_id)),
                "speaker_id": metadata.get("speaker_id", case_id),
                "topic": metadata.get("topic", ""),
                "verdict_counts": verdict_counts(alignment),
                "decision_count": len(alignment.get("decisions", [])),
                "video_url": video_url,
                "video_format": video_format,
                "source_page_url": source_page_url,
                "source_page_label": SOURCE_PAGE_LABELS.get(case_id),
                "video_publication_status": (
                    "published" if video_url else "source_page" if source_page_url else "not_available"
                ),
                "script_type": metadata.get("script_type"),
                "script_source": script_source,
                "source_review_label": review_label,
                "review_status": intent.get("review_status", "confirmed"),
                "can_evaluate_original_intent": metadata.get(
                    "can_evaluate_original_intent", False
                ),
            }
        )
        detail.update(
            {
                "case_id": case_id,
                "metadata": public_metadata(metadata),
                "video_url": video_url,
                "video_format": video_format,
                "source_page_url": source_page_url,
                "source_page_label": SOURCE_PAGE_LABELS.get(case_id),
                "video_publication_status": (
                    "published" if video_url else "source_page" if source_page_url else "not_available"
                ),
                "report_url": f"./reports/{case_id}.md",
            }
        )
        write_json(case_output / f"{case_id}.json", detail)
        shutil.copyfile(result_dir / "report.md", report_output / f"{case_id}.md")

    media_root = DIST_ROOT / "media"
    if media_root.is_dir():
        for stale_entry in media_root.iterdir():
            if stale_entry.name not in public_media_ids or stale_entry.is_file():
                if stale_entry.is_dir():
                    shutil.rmtree(stale_entry)
                else:
                    stale_entry.unlink()

    write_json(
        DIST_ROOT / "data" / "cases.json",
        {
            "cases": cases,
            "snapshot": True,
            "video_publication_status": (
                "all_published" if all(case.get("video_url") for case in cases) else "mixed"
            ),
        },
    )
    mirror_dist_to_docs()
    print(f"Exported {len(cases)} cases to {DIST_ROOT}")


if __name__ == "__main__":
    main()
