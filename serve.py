#!/usr/bin/env python3
# 로컬 정적 서버. python -m http.server와 똑같지만 모든 응답에 캐시 금지 헤더를 붙인다.
# 모바일 브라우저가 이전 버전의 main.js/battleRenderer.js 등을 캐시해서 변경 사항이
# 반영되지 않는 문제(서버를 재시작해도 폰 쪽 캐시는 지워지지 않는다) 때문에 추가함.
import http.server
import socket
import sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


# ThreadingHTTPServer가 아니면 요청을 하나씩 처리한다 - 브라우저가 keep-alive 연결을
# 6개 열어두는 탓에 첫 로딩(파일 수백 개)이 느려지다 못해 멈춰 버린다.
# IPv4 전용(0.0.0.0)이면 브라우저가 localhost를 ::1로 먼저 시도했다가 실패해 연결마다 ~200ms를 버린다.
# '::' + V6ONLY 끔 = IPv4/IPv6 둘 다 받는다(폰에서 LAN IPv4 주소로 접속하는 것도 그대로).
class DualStackServer(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


# HTTP/1.0이면 파일마다 새 연결을 맺는다 - 첫 로딩 요청이 250개라 keep-alive(1.1)로 연결을 재사용한다.
# (test()가 protocol 인자로 핸들러의 protocol_version을 덮어쓰므로 여기서 지정해야 한다.)
http.server.test(HandlerClass=NoCacheHandler, ServerClass=DualStackServer, port=port, bind='::', protocol='HTTP/1.1')
