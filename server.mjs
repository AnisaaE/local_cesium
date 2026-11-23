import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 8080);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function fileFor(urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^[/\\]+/, "") || "index.html";
  const file = path.resolve(root, relative);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

createServer(async (request, response) => {
  try {
    const urlPath = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
    const file = fileFor(urlPath);
    if (!file) {
      response.writeHead(403);
      return response.end("Forbidden");
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not found");
    response.writeHead(200, {
      "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`new-project: http://127.0.0.1:${port}`);
});
