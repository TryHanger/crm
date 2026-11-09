import sys
import base64
import cv2
import numpy as np

def decode_qr(data_or_file: str) -> str:
    data_or_file = data_or_file.strip()
    if data_or_file.startswith("data:image"):
        payload = data_or_file.split(",", 1)[1]
        img_bytes = base64.b64decode(payload)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    else:
        img = cv2.imread(data_or_file)
    if img is None:
        return ""
    detector = cv2.QRCodeDetector()
    val, pts, _ = detector.detectAndDecode(img)
    return val

if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    print(decode_qr(arg))
