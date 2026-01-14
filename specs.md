# Base64 File Bridge Agent – Specification Sheet

## 1. Purpose

The **Base64 File Bridge Agent** is a lightweight, locally running HTTP service designed to bridge Postman (or similar API testing tools) with local filesystem access.

Its primary purpose is to:

* Read binary files from configurable local paths
* Convert them to Base64
* Expose them via a simple HTTP API

This enables automated API testing (e.g. OCR pipelines) in environments where the testing tool **cannot access the local filesystem directly**.

---

## 2. Problem Statement

Postman limitations:

* Cannot read arbitrary local files in scripts
* Cannot dynamically send raw binary bodies
* Cannot execute shell commands (curl, PowerShell)

As a result, automated OCR / file-ingestion tests requiring **variable file paths** are blocked.

The Base64 File Bridge Agent solves this by acting as a **trusted local helper service**.

---

## 3. High-Level Architecture

```
+-------------+        HTTP        +------------------------+
|  Postman    |  <--------------> | Base64 File Bridge Agent|
|  / Newman   |                   | (Local EXE, localhost) |
+-------------+                   +-----------+------------+
                                                |
                                                | FS Access
                                                v
                                         Local File System
```

---

## 4. Deployment Model

* **Form**: Single compiled executable (EXE)
* **Technology**: Node.js + `pkg`
* **Runtime**: Bundled Node.js runtime (no external dependencies)
* **Binding**: `127.0.0.1` only
* **OS Targets**:

  * Windows x64 (primary)
  * Optional: Linux x64, macOS

---

## 5. API Specification

### 5.1 Base64 Encode File

**Endpoint**

```
GET /base64
```

**Query Parameters**

| Name   | Type   | Required | Description                 |
| ------ | ------ | -------- | --------------------------- |
| `path` | string | yes      | Absolute path to local file |

**Example Request**

```
GET http://localhost:3000/base64?path=C:\tests\ocr\input\sample.pdf
```

**Successful Response (200)**

```json
{
  "fileName": "sample.pdf",
  "sizeBytes": 123456,
  "mimeType": "application/pdf",
  "base64": "JVBERi0xLjQKJc..."
}
```

**Error Responses**

| Code | Meaning                 |
| ---- | ----------------------- |
| 400  | Missing or invalid path |
| 403  | Path not allowed        |
| 404  | File not found          |
| 500  | Read or encode failure  |

---

## 6. Security Model (Critical)

### 6.1 Network Security

* Bind only to `127.0.0.1`
* No external exposure
* No HTTPS required (local only)

### 6.2 Filesystem Security

* Enforced **allow-listed root directories**
* Absolute path normalization
* Path traversal protection (`..`)

Example allow-list:

```
C:\tests\ocr\input\
```

---

## 7. Configuration

Configuration via JSON file or environment variables.

### Example `config.json`

```json
{
  "port": 3000,
  "allowedRoots": [
    "C:/tests/ocr/input"
  ],
  "maxFileSizeMB": 50
}
```

---

## 8. Testing & Validation Requirements

### 8.1 Functional Tests

* Valid file path → Base64 returned
* Non-existing file → 404
* Path outside allow-list → 403
* Empty file → valid Base64 (empty)

### 8.2 Boundary Tests

* Very large file (near limit)
* Binary formats (PDF, PNG, TIFF)
* Non-ASCII file names

### 8.3 Security Tests

* Path traversal attempts (`../`)
* URL-encoded traversal
* Symlink escape attempts

### 8.4 Performance Tests

* Repeated requests (100+ sequential)
* Concurrent requests (optional)

---

## 9. Postman Integration Pattern

### Step 1 – Call Agent

```
GET http://localhost:3000/base64?path={{filePath}}
```

### Step 2 – Store Base64

In Tests:

```javascript
pm.collectionVariables.set(
  "fileBase64",
  pm.response.json().base64
);
```

### Step 3 – Call OCR API

Body:

```json
{
  "file": "{{fileBase64}}"
}
```

---

## 10. CI / Automation Compatibility

* Compatible with Newman
* Compatible with CI runners (GitHub Actions, Azure DevOps)
* No Node.js installation required on agents

---

## 11. Build Process

### Source

* Node.js HTTP server

### Build Tool

* `pkg`

### Build Command

```
pkg server.js --targets node18-win-x64 --output base64-bridge.exe
```

---

## 12. Logging & Diagnostics

* Startup banner (port, allowed roots)
* Request logging (path, size, duration)
* Error logging with stack traces

---

## 13. Non-Goals

* No authentication beyond localhost trust
* No file uploads
* No remote filesystem access
* No persistence

---

## 14. Future Extensions (Optional)

* Multipart response support
* Raw binary streaming endpoint
* SHA-256 checksum endpoint
* Access token for added safety

---

## 15. Summary

The Base64 File Bridge Agent is a **purpose-built, minimal, secure helper service** enabling robust automated testing of binary-ingestion APIs where direct filesystem access is unavailable.

It is intentionally simple, locally scoped, and CI-friendly.
