#!/usr/bin/env python3
import json
import sys

from paddleocr import PaddleOCR


# PaddleOCR API changed across versions:
#   Old: PaddleOCR(use_angle_cls=True, show_log=False)
#   New: PaddleOCR(use_textline_orientation=True)  (show_log removed)
try:
    ocr = PaddleOCR(use_textline_orientation=True, lang='en')
except (TypeError, ValueError):
    ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)

for line in sys.stdin:
    request_id = ""
    try:
        data = json.loads(line)
        request_id = str(data.get("id", ""))
        image_paths = data.get("imagePaths", [])

        results = []
        for path in image_paths:
            # New PaddleOCR: cls= kwarg removed (angle cls set in constructor)
            # Old PaddleOCR: cls=True enables angle classification
            try:
                res = ocr.ocr(path)
            except TypeError:
                res = ocr.ocr(path, cls=True)
            for block in res or []:
                for entry in block or []:
                    text = entry[1][0].strip()
                    if text:
                        results.append(text)

        print(json.dumps({"id": request_id, "text": "\n".join(results)}))
        sys.stdout.flush()
    except Exception:
        print(json.dumps({"id": request_id, "text": ""}))
        sys.stdout.flush()
