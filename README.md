# Base64 File Bridge

A simple Node.js web server that serves files converted to Base64, primarily intended to be used as a bridge for applications that need to access local files securely.

## Features

*   **Secure File Access**: Provides Base64 encoded content of specified files.
*   **Path Traversal Protection**: Prevents access to unauthorized directories.
*   **Configurable Root Directories**: Restricts file access to a predefined list of allowed directories.
*   **Max File Size Limit**: Prevents serving excessively large files.
*   **Configuration via `config.json` or Environment Variables**: Flexible configuration options.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   Node.js (LTS version recommended)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/webserverfilebridge.git
    cd webserverfilebridge
    ```
2.  Install NPM packages:
    ```bash
    npm install
    ```

### Configuration

The server can be configured using `config.json` located next to the executable or through environment variables.

#### `config.json` Example:

```json
{
  "port": 3000,
  "allowedRoots": [
    "C:\\path\\to\\your\\files",
    "/another/path/to/files"
  ],
  "maxFileSizeMB": 50
}
```

*   `port`: The port on which the server will listen. Defaults to `3000`.
*   `allowedRoots`: An array of absolute paths that the server is allowed to access. **Crucial for security.** Files outside these roots cannot be served.
*   `maxFileSizeMB`: The maximum allowed file size in megabytes. Defaults to `50`.

#### Environment Variables:

*   `PORT`: Overrides the `port` setting.
*   `ALLOWED_ROOTS`: A comma-separated list of paths, e.g., `C:\path1,C:\path2`. Overrides `allowedRoots`.
*   `MAX_FILE_SIZE_MB`: Overrides the `maxFileSizeMB` setting.

### Running the Server

To start the server:

```bash
node server.js
```

The server will log its binding address, allowed roots, and max file size.

### API Endpoints

#### `GET /base64`

Retrieves the Base64 encoded content of a file.

**Query Parameters:**

*   `path` (required): The absolute or relative path to the file. This path must resolve to a location within one of the `allowedRoots`.

**Example Request:**

```
GET http://127.0.0.1:3000/base64?path=C:\path\to\your\files\example.txt
```

**Example Response (Success):**

```json
{
  "fileName": "example.txt",
  "sizeBytes": 1234,
  "mimeType": "text/plain",
  "base64": "SGVsbG8gV29ybGQhCg=="
}
```

**Error Responses:**

*   `400 Bad Request`: Missing `path` parameter, invalid path format, or file size exceeds limit.
*   `403 Forbidden`: Path traversal attempt detected, or access to the specified path is not allowed by configuration.
*   `404 Not Found`: File not found or path is not a file.
*   `500 Internal Server Error`: Failed to read or encode file due to server-side issues.

## Development

### Running Tests

```bash
npm test
```

## Building the Executable (Optional)

This project can be packaged into a standalone executable using `pkg`.

```bash
npm run build
```

This will create an executable in the `out` directory.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](https://choosealicense.com/licenses/mit/)
