"""Export the local TalkEval artifacts as a browser-only public snapshot."""

from __future__ import annotations

import json
import shutil
from pathlib import Path


DEMO_ROOT = Path(__file__).resolve().parents[2]
INPUT_ROOT = DEMO_ROOT / "real_data" / "incoming"
OUTPUT_ROOT = DEMO_ROOT / "artifacts" / "real-batch"
DIST_ROOT = Path(__file__).resolve().parents[1] / "dist"

ARTIFACTS = {
    "intent_map": "intent_map.json",
    "expression_map": "expression_map.json",
    "alignment": "alignment.json",
    "asr": "asr.json",
    "run_metadata": "run_metadata.json",
}


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


def main() -> None:
    cases: list[dict[str, object]] = []
    case_output = DIST_ROOT / "data" / "cases"
    report_output = DIST_ROOT / "reports"
    case_output.mkdir(parents=True, exist_ok=True)
    report_output.mkdir(parents=True, exist_ok=True)

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
        intent = detail["intent_map"]
        alignment = detail["alignment"]
        cases.append(
            {
                "case_id": case_id,
                "title": intent.get("title", metadata.get("topic", case_id)),
                "speaker_id": metadata.get("speaker_id", case_id),
                "topic": metadata.get("topic", ""),
                "verdict_counts": verdict_counts(alignment),
                "decision_count": len(alignment.get("decisions", [])),
                "video_url": None,
                "script_type": metadata.get("script_type"),
                "can_evaluate_original_intent": metadata.get(
                    "can_evaluate_original_intent", False
                ),
            }
        )
        detail.update(
            {
                "case_id": case_id,
                "metadata": metadata,
                "video_url": None,
                "video_publication_status": "not_published_pending_usage_review",
                "report_url": f"./reports/{case_id}.md",
            }
        )
        write_json(case_output / f"{case_id}.json", detail)
        shutil.copyfile(result_dir / "report.md", report_output / f"{case_id}.md")

    write_json(
        DIST_ROOT / "data" / "cases.json",
        {
            "cases": cases,
            "snapshot": True,
            "video_publication_status": "not_published_pending_usage_review",
        },
    )
    print(f"Exported {len(cases)} cases to {DIST_ROOT}")


if __name__ == "__main__":
    main()
