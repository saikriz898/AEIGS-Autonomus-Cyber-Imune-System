"""Bound request bytes before FastAPI's multipart parser can spool them."""

import json
from tempfile import SpooledTemporaryFile


class BodyLimitMiddleware:
    def __init__(self, app, max_upload_bytes=104857600, json_limit=1048576):
        self.app = app
        self.max_upload_bytes = max_upload_bytes
        self.json_limit = json_limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        multipart = headers.get(b"content-type", b"").lower().startswith(b"multipart/form-data")
        limit = self.max_upload_bytes + 65536 if multipart else self.json_limit

        async def reject(status, message):
            body = json.dumps({"detail": message}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": status,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                        (b"cache-control", b"no-store"),
                        (b"x-content-type-options", b"nosniff"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})

        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await reject(400, "Invalid Content-Length header.")
        if length < 0:
            return await reject(400, "Invalid Content-Length header.")
        if length > limit:
            return await reject(413, "Request body exceeds the configured size limit.")
        # Spool only bounded bytes to a private temporary file, so an untrusted
        # multipart parser never receives an unchecked or unbounded stream.
        with SpooledTemporaryFile(max_size=1048576, mode="w+b") as body:
            total = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                total += len(chunk)
                if total > limit:
                    return await reject(413, "Request body exceeds the configured size limit.")
                body.write(chunk)
                if not message.get("more_body", False):
                    break
            body.seek(0)
            exhausted = False

            async def replay():
                nonlocal exhausted
                if exhausted:
                    return await receive()
                chunk = body.read(65536)
                exhausted = body.tell() >= total
                return {"type": "http.request", "body": chunk, "more_body": not exhausted}

            await self.app(scope, replay, send)
