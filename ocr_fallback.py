#!/usr/bin/env python3
import sys


def main() -> int:
    image_paths = sys.argv[1:]
    if not image_paths:
        return 0

    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception:
        return 0

    try:
        ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
    except Exception:
        return 0

    chunks = []
    for image_path in image_paths:
        try:
            result = ocr.ocr(image_path, cls=True)
        except Exception:
            continue

        lines = []
        for block in result or []:
            for entry in block or []:
                if not entry or len(entry) < 2:
                    continue
                text = (entry[1][0] or '').strip()
                if text:
                    lines.append(text)
        if lines:
            chunks.append("\n".join(lines))

    if chunks:
        sys.stdout.write("\n".join(chunks))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
