import { vi } from "vitest";

/**
 * In-memory S3Client stub for tests. Implements only the subset of the
 * S3 surface our storage helpers actually exercise:
 *   - PutObjectCommand
 *   - GetObjectCommand
 *   - ListObjectsV2Command
 *   - DeleteObjectCommand
 *   - DeleteObjectsCommand
 *
 * Returned object exposes:
 *   - `client`: cast to whatever S3Client-shaped param the helper expects
 *   - `store`: the underlying Map for direct assertions
 *   - `send`: the vi.fn for call-count assertions
 *   - `failNext` / `failOnPut`: hooks for simulating storage failure
 */
export function createInMemoryStorage() {
  const store = new Map<string, string>();
  const fails: ((commandName: string) => boolean)[] = [];

  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    const name = command.constructor.name;
    const input = command.input as Record<string, unknown>;

    // Apply queued failure predicates (consume on match).
    for (let i = 0; i < fails.length; i += 1) {
      const pred = fails[i];
      if (pred && pred(name)) {
        fails.splice(i, 1);
        const err = new Error(`Simulated storage failure on ${name}`);
        (err as Error & { name: string }).name = "SimulatedError";
        throw err;
      }
    }

    if (name === "PutObjectCommand") {
      const key = input.Key as string;
      const body = input.Body;
      const text =
        body instanceof Buffer
          ? body.toString("utf-8")
          : typeof body === "string"
            ? body
            : String(body);
      store.set(key, text);
      return {};
    }
    if (name === "GetObjectCommand") {
      const key = input.Key as string;
      if (!store.has(key)) {
        const err = new Error("NoSuchKey");
        (err as Error & { name: string }).name = "NoSuchKey";
        throw err;
      }
      const content = store.get(key) ?? "";
      const body = (async function* () {
        yield Buffer.from(content, "utf-8");
      })();
      return { Body: body };
    }
    if (name === "DeleteObjectCommand") {
      store.delete(input.Key as string);
      return {};
    }
    if (name === "ListObjectsV2Command") {
      const prefix = (input.Prefix as string) ?? "";
      const contents = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ Key: key }));
      return { Contents: contents, IsTruncated: false };
    }
    if (name === "DeleteObjectsCommand") {
      const del = input.Delete as { Objects: { Key: string }[] };
      for (const { Key } of del.Objects) {
        store.delete(Key);
      }
      return {};
    }
    throw new Error(`unexpected command ${name}`);
  });

  return {
    send,
    store,
    /** Make the next matching command throw a SimulatedError. */
    failNext(predicate: (commandName: string) => boolean) {
      fails.push(predicate);
    },
    /** Make the Nth (0-indexed) PutObjectCommand throw. */
    failOnPut(occurrence: number) {
      let seen = -1;
      fails.push((name) => {
        if (name !== "PutObjectCommand") return false;
        seen += 1;
        return seen === occurrence;
      });
    },
    get client() {
      return this as unknown as { send: typeof send };
    },
  };
}

export type InMemoryStorage = ReturnType<typeof createInMemoryStorage>;
