#!/usr/bin/env python3
# 로컬 정적 서버. python -m http.server와 똑같지만 모든 응답에 캐시 금지 헤더를 붙인다.
# 모바일 브라우저가 이전 버전의 main.js/battleRenderer.js 등을 캐시해서 변경 사항이
# 반영되지 않는 문제(서버를 재시작해도 폰 쪽 캐시는 지워지지 않는다) 때문에 추가함.
import http.server
import sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


http.server.test(HandlerClass=NoCacheHandler, port=port, bind='0.0.0.0')
