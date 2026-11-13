
import json
import sys
import time
from urllib.parse import urlsplit

from curl_cffi import requests


def main():
    if len(sys.argv) != 2:
        raise SystemExit("사용법: python naver-fetch.py <URL>")

    url = sys.argv[1]
    parsed_url = urlsplit(url)

    print("===== NAVER API 요청 시작 =====", file=sys.stderr)
    print(f"Host: {parsed_url.netloc}", file=sys.stderr)
    print(f"Path: {parsed_url.path}", file=sys.stderr)
    print("TLS impersonation: chrome", file=sys.stderr)

    start_time = time.monotonic()

    try:
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

    except Exception as exc:
        elapsed = round(time.monotonic() - start_time, 2)

        print("===== NAVER API 연결 실패 =====", file=sys.stderr)
        print(f"경과 시간: {elapsed}초", file=sys.stderr)
        print(f"오류 유형: {type(exc).__name__}", file=sys.stderr)
        print(f"오류 내용: {exc}", file=sys.stderr)

        raise

    elapsed = round(time.monotonic() - start_time, 2)

    print("===== NAVER API 응답 수신 =====", file=sys.stderr)
    print(f"HTTP 상태 코드: {response.status_code}", file=sys.stderr)
    print(f"응답 시간: {elapsed}초", file=sys.stderr)

    for header in (
        "server",
        "content-type",
        "retry-after",
        "cf-ray",
        "via",
    ):
        value = response.headers.get(header)
        if value:
            print(f"{header}: {value}", file=sys.stderr)

    if response.status_code != 200:
        print("===== NAVER API 비정상 응답 =====", file=sys.stderr)
        print(
            f"응답 내용: {response.text[:1000]}",
            file=sys.stderr
        )

        raise RuntimeError(
            f"Naver API HTTP {response.status_code}"
        )

    try:
        data = response.json()
    except Exception as exc:
        print("===== JSON 파싱 실패 =====", file=sys.stderr)
        print(f"오류 유형: {type(exc).__name__}", file=sys.stderr)
        print(f"응답 내용: {response.text[:1000]}", file=sys.stderr)
        raise

    print("===== NAVER API JSON 수신 성공 =====", file=sys.stderr)

    sys.stdout.write(json.dumps(data, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Naver API 요청 실패: {exc}", file=sys.stderr)
        raise
