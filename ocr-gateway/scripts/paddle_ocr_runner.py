import argparse
import contextlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


ENVIRONMENT_ERROR_CODE = "paddle_environment"
PAGE_FAILED_WARNING = "paddle_page_failed"


def log(message: str) -> None:
    print(message, file=sys.stderr)


def write_json(output_path: str, payload: Dict[str, Any]) -> None:
    Path(output_path).write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )


def write_json_guarded(output_path: str, payload: Dict[str, Any]) -> bool:
    try:
        write_json(output_path, payload)
        return True
    except Exception:
        log("Failed to write OCR output.")
        return False


def read_manifest(manifest_path: str) -> Dict[str, Any]:
    try:
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    except Exception as error:
        raise ValueError(f"Invalid manifest JSON: {error}") from error

    if not isinstance(manifest, dict):
        raise ValueError("Invalid manifest: expected an object.")

    pages = manifest.get("pages")
    if not isinstance(pages, list):
        raise ValueError("Invalid manifest: pages must be an array.")

    for index, page in enumerate(pages):
        if not isinstance(page, dict):
            raise ValueError(f"Invalid manifest: page {index + 1} must be an object.")
        if not isinstance(page.get("pageId"), str):
            raise ValueError(f"Invalid manifest: page {index + 1} is missing pageId.")
        if not isinstance(page.get("imagePath"), str):
            raise ValueError(f"Invalid manifest: page {index + 1} is missing imagePath.")

    return manifest


def load_paddle_ocr(lang: str) -> Any:
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from paddleocr import PaddleOCR
    except Exception as error:
        raise RuntimeError(f"Failed to import PaddleOCR: {error}") from error

    try:
        with contextlib.redirect_stdout(sys.stderr):
            return PaddleOCR(use_angle_cls=True, lang=lang)
    except Exception as error:
        raise RuntimeError(f"Failed to initialize PaddleOCR: {error}") from error


def confidence_value(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    confidence = float(value)
    if not math.isfinite(confidence):
        return None
    return confidence


def extract_dict_lines(value: Dict[str, Any]) -> List[Tuple[str, Optional[float]]]:
    rec_texts = value.get("rec_texts")
    if isinstance(rec_texts, list):
        scores = value.get("rec_scores")
        lines: List[Tuple[str, Optional[float]]] = []
        for index, text in enumerate(rec_texts):
            if not isinstance(text, str):
                continue
            score = None
            if isinstance(scores, list) and index < len(scores):
                score = confidence_value(scores[index])
            lines.append((text, score))
        return lines

    for text_key in ("text", "transcription"):
        text = value.get(text_key)
        if isinstance(text, str):
            score = confidence_value(value.get("confidence"))
            if score is None:
                score = confidence_value(value.get("score"))
            return [(text, score)]

    return []


def extract_tuple_line(value: Any) -> Optional[Tuple[str, Optional[float]]]:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None

    text_confidence = value[1]
    if (
        isinstance(text_confidence, (list, tuple))
        and len(text_confidence) >= 1
        and isinstance(text_confidence[0], str)
    ):
        score = confidence_value(text_confidence[1]) if len(text_confidence) > 1 else None
        return text_confidence[0], score

    if isinstance(value[0], str):
        return value[0], confidence_value(value[1])

    return None


def extract_lines(value: Any) -> List[Tuple[str, Optional[float]]]:
    if value is None:
        return []

    if isinstance(value, dict):
        dict_lines = extract_dict_lines(value)
        if dict_lines:
            return dict_lines
        for child in value.values():
            child_lines = extract_lines(child)
            if child_lines:
                return child_lines
        return []

    tuple_line = extract_tuple_line(value)
    if tuple_line is not None:
        return [tuple_line]

    if isinstance(value, list):
        lines: List[Tuple[str, Optional[float]]] = []
        for child in value:
            lines.extend(extract_lines(child))
        return lines

    return []


def recognize_page(ocr: Any, page: Dict[str, Any]) -> Dict[str, Any]:
    page_id = page["pageId"]
    try:
        with contextlib.redirect_stdout(sys.stderr):
            raw_result = ocr.ocr(page["imagePath"], cls=True)

        lines = extract_lines(raw_result)
        page_result: Dict[str, Any] = {
            "pageId": page_id,
            "text": "\n".join(text for text, _score in lines),
        }

        scores = [score for _text, score in lines if score is not None]
        if scores:
            page_result["confidence"] = sum(scores) / len(scores)

        return page_result
    except Exception as error:
        log(f"Page OCR failed for {page_id}: {error}")
        return {
            "pageId": page_id,
            "text": "",
            "warnings": [PAGE_FAILED_WARNING],
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run PaddleOCR over a gateway manifest.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--lang", default="en")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        manifest = read_manifest(args.manifest)
    except Exception as error:
        log(str(error))
        if not write_json_guarded(args.output, {"error": str(error)}):
            return 1
        return 0

    try:
        ocr = load_paddle_ocr(args.lang)
    except Exception as error:
        log(str(error))
        if not write_json_guarded(
            args.output,
            {
                "error": str(error),
                "errorCode": ENVIRONMENT_ERROR_CODE,
            },
        ):
            return 1
        return 0

    pages = [recognize_page(ocr, page) for page in manifest["pages"]]
    if not write_json_guarded(args.output, {"pages": pages}):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
