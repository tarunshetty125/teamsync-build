#!/usr/bin/env python3
import json
import sys

from paddleocr import PaddleOCR


ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)

for line in sys.stdin:
    try:
        data = json.loads(line)
        image_paths = data.get("imagePaths", [])

        results = []
        for path in image_paths:
            res = ocr.ocr(path, cls=True)
            for block in res or []:
                for entry in block or []:
                    text = entry[1][0].strip()
                    if text:
                        results.append(text)

        print(json.dumps({"text": "\n".join(results)}))
        sys.stdout.flush()
    except Exception:
        print(json.dumps({"text": ""}))
        sys.stdout.flush()
