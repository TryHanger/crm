"""Minimal S3-compatible client (AWS Signature V4) on the standard library (M16).

Used for offsite backups: works with AWS S3, Yandex Object Storage, PS Cloud / any S3-compatible storage,
and with a local gateway (versitygw) for the restore drill. Path-style addressing only.

Settings (environment):
  OFFSITE_S3_ENDPOINT    https://storage.example.kz   (no bucket in the URL)
  OFFSITE_S3_BUCKET      crm-backups
  OFFSITE_S3_ACCESS_KEY / OFFSITE_S3_SECRET_KEY
  OFFSITE_S3_REGION      default us-east-1
  OFFSITE_S3_PREFIX      default crm/
The secret key is never printed or put into exceptions.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import os
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Dict, List, Optional


class S3Error(Exception):
    pass


@dataclass
class S3Config:
    endpoint: str
    bucket: str
    access_key: str
    secret_key: str
    region: str = "us-east-1"
    prefix: str = "crm/"

    @classmethod
    def from_env(cls) -> Optional["S3Config"]:
        env = os.environ
        endpoint, bucket = env.get("OFFSITE_S3_ENDPOINT", "").strip(), env.get("OFFSITE_S3_BUCKET", "").strip()
        access, secret = env.get("OFFSITE_S3_ACCESS_KEY", "").strip(), env.get("OFFSITE_S3_SECRET_KEY", "").strip()
        if not (endpoint and bucket and access and secret):
            return None
        prefix = env.get("OFFSITE_S3_PREFIX", "crm/").strip()
        return cls(endpoint.rstrip("/"), bucket, access, secret, env.get("OFFSITE_S3_REGION", "us-east-1").strip() or "us-east-1",
                   prefix if prefix.endswith("/") or not prefix else prefix + "/")

    def __repr__(self) -> str:  # never leak the secret through logs
        return f"S3Config(endpoint={self.endpoint!r}, bucket={self.bucket!r}, prefix={self.prefix!r})"


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def _file_md5(path: str) -> str:
    h = hashlib.md5()  # noqa: S324 - S3 ETag of a single-part upload, integrity only
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


class S3Client:
    def __init__(self, cfg: S3Config, timeout: float = 120):
        self.cfg, self.timeout = cfg, timeout
        self.host = urllib.parse.urlparse(cfg.endpoint).netloc

    def _request(self, method: str, key: str = "", query: Optional[Dict[str, str]] = None,
                 body_path: Optional[str] = None, out_path: Optional[str] = None, bucket_level: bool = False):
        now = dt.datetime.now(dt.timezone.utc)
        amz_date, datestamp = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        payload_hash = _file_sha256(body_path) if body_path else hashlib.sha256(b"").hexdigest()
        uri = "/" + urllib.parse.quote(self.cfg.bucket, safe="")
        if key:
            uri += "/" + urllib.parse.quote(key, safe="/-_.~")
        q = sorted((query or {}).items())
        canonical_qs = "&".join(f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}" for k, v in q)
        canonical_headers = f"host:{self.host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
        signed = "host;x-amz-content-sha256;x-amz-date"
        creq = "\n".join([method, uri, canonical_qs, canonical_headers, signed, payload_hash])
        scope = f"{datestamp}/{self.cfg.region}/s3/aws4_request"
        sts = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(creq.encode()).hexdigest()])
        k = _hmac(_hmac(_hmac(_hmac(("AWS4" + self.cfg.secret_key).encode(), datestamp), self.cfg.region), "s3"), "aws4_request")
        sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
        headers = {"x-amz-date": amz_date, "x-amz-content-sha256": payload_hash,
                   "Authorization": f"AWS4-HMAC-SHA256 Credential={self.cfg.access_key}/{scope}, SignedHeaders={signed}, Signature={sig}"}
        url = self.cfg.endpoint + uri + (f"?{canonical_qs}" if canonical_qs else "")
        data = None
        if body_path:
            headers["Content-Length"] = str(os.path.getsize(body_path))
            data = open(body_path, "rb")
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                if out_path:
                    with open(out_path, "wb") as f:
                        while chunk := resp.read(1 << 20):
                            f.write(chunk)
                    return resp.status, dict(resp.headers), b""
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode(errors="replace")
            code = ET.fromstring(detail).findtext("Code") if detail.startswith("<?xml") or detail.startswith("<Error") else ""
            raise S3Error(f"S3 {method} {('/' + key) if key else ''}: HTTP {e.code} {code or ''}".strip()) from None
        except urllib.error.URLError as e:
            raise S3Error(f"S3 endpoint unreachable: {type(e.reason).__name__}") from None
        finally:
            if data is not None:
                data.close()

    def ensure_bucket(self) -> None:
        try:
            self._request("HEAD")
        except S3Error:
            self._request("PUT")

    def put_file(self, key: str, path: str) -> Dict[str, str]:
        _, headers, _ = self._request("PUT", key, body_path=path)
        etag = (headers.get("ETag") or headers.get("Etag") or "").strip('"')
        local_md5 = _file_md5(path)
        if etag and "-" not in etag and etag != local_md5:
            raise S3Error(f"S3 integrity check failed for {key}: ETag does not match the uploaded file")
        return {"key": key, "etag": etag, "size_bytes": os.path.getsize(path)}

    def get_file(self, key: str, path: str) -> str:
        self._request("GET", key, out_path=path)
        return path

    def head(self, key: str) -> Dict[str, str]:
        _, headers, _ = self._request("HEAD", key)
        return headers

    def list_keys(self, prefix: str) -> List[Dict[str, str]]:
        out, token = [], None
        while True:
            q = {"list-type": "2", "prefix": prefix}
            if token:
                q["continuation-token"] = token
            _, _, body = self._request("GET", query=q)
            root = ET.fromstring(body)
            ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
            for c in root.findall(f"{ns}Contents"):
                out.append({"key": c.findtext(f"{ns}Key"), "size": c.findtext(f"{ns}Size"),
                            "last_modified": c.findtext(f"{ns}LastModified")})
            if root.findtext(f"{ns}IsTruncated") != "true":
                return out
            token = root.findtext(f"{ns}NextContinuationToken")

    def delete(self, key: str) -> None:
        self._request("DELETE", key)
