import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { JobService } from "./JobService";

// A minimal loopback-only HTTP server the paired browser extension uses to
// fetch the user's own profile and resume for form-filling. It binds to
// 127.0.0.1 exclusively — never a public interface — and serves no job data
// outward. CORS is restricted to extension origins.
let server: Server | null = null;
let boundPort = 0;

// A random token generated per app launch. The extension must present it,
// which stops arbitrary local web pages from reading the data.
let pairingToken = "";

export function getPairingToken(): string {
  return pairingToken;
}

export function getLocalPort(): number {
  return boundPort;
}

function randomToken(): string {
  // 32 hex chars from crypto. Avoids pulling in a dependency.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function startLocalServer(service: JobService): Promise<number> {
  pairingToken = randomToken();
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      // Only allow Chrome/Edge extension origins; reject everything else.
      const origin = req.headers.origin ?? "";
      const isExtension =
        origin.startsWith("chrome-extension://") ||
        origin.startsWith("moz-extension://") ||
        origin === "";
      res.setHeader("Access-Control-Allow-Origin", isExtension ? origin : "null");
      res.setHeader("Access-Control-Allow-Headers", "x-jobwell-token");
      res.setHeader("Vary", "Origin");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Token gate for data endpoints.
      const token = req.headers["x-jobwell-token"];
      if (req.url !== "/ping" && token !== pairingToken) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      if (req.url === "/ping") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, app: "jobwell" }));
        return;
      }

      if (req.url === "/fill-data") {
        void (async () => {
          const profile = await service.getProfile();
          const resume = await service.getResume();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              profile: profile
                ? {
                    location: profile.location,
                    // jobFunction is now a list; expose the primary (first)
                    // role for single-field autofill in the extension.
                    jobFunction: profile.jobFunction?.[0] ?? "",
                  }
                : null,
              resumeFileName: resume?.fileName ?? null,
            }),
          );
        })();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    // 127.0.0.1 only — the second arg to listen is the host. Never 0.0.0.0.
    server.listen(0, "127.0.0.1", () => {
      boundPort = (server!.address() as AddressInfo).port;
      resolve(boundPort);
    });
    server.on("error", reject);
  });
}

export function stopLocalServer(): void {
  server?.close();
  server = null;
}
