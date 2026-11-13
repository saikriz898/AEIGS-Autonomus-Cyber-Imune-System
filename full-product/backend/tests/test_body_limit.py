import asyncio
import json
from app.body_limit import BodyLimitMiddleware


def request(chunks, headers=(), max_upload=100, json_limit=100):
    messages = []
    called = []
    queue = [
        {"type": "http.request", "body": chunk, "more_body": i < len(chunks) - 1}
        for i, chunk in enumerate(chunks)
    ]

    async def receive():
        return queue.pop(0) if queue else {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    async def downstream(scope, receive, send):
        called.append(True)
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body", False):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": body})

    scope = {"type": "http", "method": "POST", "path": "/api/test", "headers": headers}
    asyncio.run(
        BodyLimitMiddleware(downstream, max_upload_bytes=max_upload, json_limit=json_limit)(
            scope, receive, send
        )
    )
    return messages, called


def test_declared_oversize_rejected_before_parser():
    messages, called = request([b"x"], [(b"content-length", b"1000000000")])
    assert messages[0]["status"] == 413 and not called


def test_unknown_length_stream_is_counted_and_bounded():
    messages, called = request([b"a" * 60, b"b" * 60])
    assert messages[0]["status"] == 413 and not called


def test_valid_chunked_body_replayed_exactly():
    messages, called = request([b"first", b"second"])
    assert called and messages[0]["status"] == 200 and messages[1]["body"] == b"firstsecond"


def test_multipart_limit_includes_bounded_overhead():
    messages, called = request(
        [b"x" * 66000], [(b"content-type", b"multipart/form-data; boundary=a")]
    )
    assert messages[0]["status"] == 413 and not called


def test_invalid_content_length_is_rejected():
    messages, called = request([b"x"], [(b"content-length", b"invalid")])
    assert messages[0]["status"] == 400 and not called
