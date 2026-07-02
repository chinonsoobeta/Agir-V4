# Document anti-virus scanning

Every uploaded document passes through `scanDocument()` in
`src/lib/upload-guards.server.ts` before any parsing or extraction touches it.
The scan has two layers:

1. **Structural scan (always on, no network).** Magic-byte signature vs
   extension, empty/oversize rejection, disguised-binary detection. This runs
   even with no scanner configured and fails closed on mismatch.
2. **External AV scan (config-gated).** When `DOCUMENT_SCAN_URL` is set, the
   raw bytes are POSTed to that endpoint and an "infected" verdict
   hard-rejects the file before extraction. A network error or timeout also
   rejects (fail-closed) unless `DOCUMENT_SCAN_FAIL_OPEN=1`.

The verdict is persisted on the document row (`scan_status`,
`scan_detail` prefixed with the engine that decided: `[structural]` or
`[external]`), so an evaluator can always see which engine cleared a file.

## Wiring a real ClamAV scanner (pilot-ready path)

Vercel functions cannot open raw TCP sockets, so the integration speaks HTTP
to a ClamAV REST bridge rather than the clamd 3310 protocol. Any bridge works;
the verdict parser (`parseExternalScanVerdict`) understands the common
response shapes:

| Bridge response | Treated as |
| --- | --- |
| HTTP 4xx/5xx (clamav-rest returns 406 on detection) | rejected |
| `200` + `{"Status":"OK"}` | clean |
| `200` + `{"Status":"FOUND", "Description": "..."}` | rejected |
| `200` + `{"clean": false, "detail": "..."}` | rejected |
| `200` + `{"infected": true}` / `{"isInfected": true, "viruses": [...]}` | rejected |
| `200` + text containing a clamd `... FOUND` line | rejected |
| `200` with no verdict payload | clean |

### Option A - containerized clamav-rest (self-hosted)

```bash
docker run -d --name clamav-rest -p 9000:9000 ajilaach/clamav-rest
# health: curl http://localhost:9000/  scan: POST multipart "file" to /scan
```

Then set:

```
DOCUMENT_SCAN_URL=https://<your-host>:9000/scan
DOCUMENT_SCAN_FORMAT=multipart
```

`DOCUMENT_SCAN_FORMAT=multipart` makes the app send a multipart form with the
file under the `file` field (what clamav-rest expects). Leave it unset for
endpoints that accept raw `application/octet-stream` bytes.

### Option B - cloud scanning API

Any HTTPS endpoint honoring the contract above works (e.g. a serverless
function fronting VirusTotal/OPSWAT, or an internal scanning gateway). Raw
bytes arrive with an `x-file-name` header for logging.

## Verifying the integration

Use the EICAR test string (safe, industry-standard AV test file):

```bash
printf 'X5O!P%%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > /tmp/eicar.txt
# upload /tmp/eicar.txt (renamed to .txt is fine) through the Documents page
# -> the document must show scan_status=rejected with the scanner's detail
```

Unit coverage for the verdict parsing and fail-closed behavior lives in
`src/test/safety-and-integrity.test.ts` ("external AV scan").

## Operational notes

- **Fail-closed is the default.** If the scanner is down, uploads are rejected
  with "Safety scan unavailable". During a planned scanner outage set
  `DOCUMENT_SCAN_FAIL_OPEN=1` (each waved-through file records that fact in
  its `scan_detail`).
- `npm run env:validate` warns when `DOCUMENT_SCAN_URL` is unset in
  staging/production; the health endpoint reports `scannerConfigured`.
- The 30s scan timeout bounds the upload path; files up to the 75 MB app
  limit are within a single-request scan for clamd.
