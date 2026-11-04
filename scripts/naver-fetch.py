import json
import sys
from curl_cffi import requests

def main():
    if len(sys.argv) != 2:
        raise SystemExit("사용법: python naver-fetch.py <URL>")

    url = sys.argv[1]

    response = requests.get(
        url,
        impersonate="chrome",
        headers={
            "Referer": "https://m.sports.naver.com/",
            "Origin": "https://m.sports.naver.com",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ko-KR,ko;q=0.9",
        },
        timeout=30,
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"Naver API HTTP {response.status_code}: {response.text[:500]}"
        )

    # 응답 본문이 정상 JSON인지 확인한 뒤, Node.js로 JSON 문자열을 전달합니다.
    data = response.json()
    sys.stdout.write(json.dumps(data, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Naver API 요청 실패: {exc}", file=sys.stderr)
        raise
