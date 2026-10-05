import type { EncodedBytes, SerialisedBuildArtifact } from "../schemas/test-judge";

export type WireBuildArtifact =
  | { kind: "wasm"; bytes: Uint8Array }
  | { kind: "runtime-bundle"; files: Readonly<Record<string, string | Uint8Array>> };

const BINARY_CHUNK = 0x8000;

function encodeBytes(bytes: Uint8Array): EncodedBytes {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BINARY_CHUNK));
  }
  return { base64: btoa(binary) };
}

function decodeBytes({ base64 }: EncodedBytes): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function serialiseBuildArtifact(artifact: WireBuildArtifact): SerialisedBuildArtifact {
  if (artifact.kind === "wasm") return { ...artifact, bytes: encodeBytes(artifact.bytes) };
  const files = Object.entries(artifact.files).map(
    ([path, content]): [string, string | EncodedBytes] => [
      path,
      typeof content === "string" ? content : encodeBytes(content),
    ],
  );
  return { ...artifact, files: Object.fromEntries(files) };
}

export function deserialiseBuildArtifact(
  serialised: SerialisedBuildArtifact,
): WireBuildArtifact {
  if (serialised.kind === "wasm") {
    return { ...serialised, bytes: decodeBytes(serialised.bytes) };
  }
  const files = Object.entries(serialised.files).map(
    ([path, content]): [string, string | Uint8Array] => [
      path,
      typeof content === "string" ? content : decodeBytes(content),
    ],
  );
  return { ...serialised, files: Object.fromEntries(files) };
}
