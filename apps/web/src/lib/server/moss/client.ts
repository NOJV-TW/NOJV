import * as net from "node:net";

import { createLogger } from "../logger";

const logger = createLogger("moss");

const MOSS_HOST = "moss.stanford.edu";
const MOSS_PORT = 7690;

/** Map NOJV language enum values to MOSS language identifiers. */
const LANGUAGE_MAP: Record<string, string> = {
  c: "c",
  cpp: "cc",
  go: "c",
  java: "java",
  javascript: "javascript",
  python: "python",
  rust: "c",
  typescript: "javascript"
};

export function getMossLanguage(nojvLanguage: string): string | null {
  return LANGUAGE_MAP[nojvLanguage] ?? null;
}

export interface MossFile {
  content: string;
  displayName: string;
}

export interface MossResult {
  url: string;
}

/**
 * Submit files to the MOSS plagiarism detection service.
 *
 * Protocol: connect via TCP to moss.stanford.edu:7690 and follow
 * the MOSS socket protocol (user ID, language, file uploads, query).
 */
export async function submitToMoss(
  userId: string,
  language: string,
  files: MossFile[],
  maxMatches = 250
): Promise<MossResult> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let responseData = "";

    socket.setTimeout(120_000);

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("MOSS connection timed out"));
    });

    socket.on("error", (err) => {
      reject(new Error(`MOSS connection error: ${err.message}`));
    });

    socket.connect(MOSS_PORT, MOSS_HOST, () => {
      logger.info("Connected to MOSS", { language, fileCount: files.length });

      // 1. Send user ID
      socket.write(`moss ${userId}\n`);
      // 2. Directory mode off
      socket.write("directory 0\n");
      // 3. No base files
      socket.write("X 0\n");
      // 4. Language
      socket.write(`language ${language}\n`);
    });

    let handshakeDone = false;
    let fileIndex = 0;

    socket.on("data", (data) => {
      const text = data.toString();

      if (!handshakeDone) {
        if (text.trim() === "no") {
          socket.destroy();
          reject(new Error("MOSS rejected the language or user ID"));
          return;
        }

        if (text.includes("yes")) {
          handshakeDone = true;

          // Upload all files
          for (const file of files) {
            fileIndex++;
            const size = Buffer.byteLength(file.content, "utf8");
            socket.write(`file ${String(fileIndex)} ${language} ${String(size)} ${file.displayName}\n`);
            socket.write(file.content);
          }

          // Send query
          socket.write(`query 0 ${String(maxMatches)}\n`);
        }
        return;
      }

      // After handshake, accumulate response (the result URL)
      responseData += text;
    });

    socket.on("end", () => {
      const url = responseData.trim();

      if (url.startsWith("http")) {
        socket.write("end\n");
        resolve({ url });
      } else {
        reject(new Error(`MOSS returned unexpected response: ${url}`));
      }
    });

    socket.on("close", () => {
      if (responseData.trim().startsWith("http")) {
        resolve({ url: responseData.trim() });
      }
    });
  });
}
