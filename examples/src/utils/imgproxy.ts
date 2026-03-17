import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64 } from "@scure/base";

export const DefaultImgProxy = {
  url: "https://imgproxy.iris.to",
  key: "f66233cb160ea07078ff28099bfa3e3e654bc10aa4a745e12176c433d79b8996",
  salt: "5e608e60945dcd2a787e8465d76ba34149894765061d39287609fb9d776caa0c",
};

type ImgProxyOptions = {
  width?: number;
  height?: number;
  square?: boolean;
};

type ImgProxyConfig = {
  url: string;
  key: string;
  salt: string;
};

const textEncoder = new TextEncoder();

function urlSafe(value: string): string {
  return value.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function hexToBytes(value: string): Uint8Array {
  const clean = value.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0) {
    throw new Error("Hex string must have an even length");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function signUrl(path: string, key: string, salt: string): string {
  const signature = hmac(
    sha256,
    hexToBytes(key),
    concatBytes(hexToBytes(salt), textEncoder.encode(path))
  );
  return urlSafe(base64.encode(signature));
}

export function generateProxyUrl(
  originalSrc: string,
  options: ImgProxyOptions = {},
  config?: Partial<ImgProxyConfig>
): string {
  const proxyConfig = {
    url: config?.url ?? DefaultImgProxy.url,
    key: config?.key ?? DefaultImgProxy.key,
    salt: config?.salt ?? DefaultImgProxy.salt,
  };

  const encodedUrl = urlSafe(base64.encode(textEncoder.encode(originalSrc)));
  const segments: string[] = [];

  if (options.width || options.height) {
    const resizeType = options.square ? "fill" : "fit";
    const width = options.width ?? options.height ?? 0;
    const height = options.height ?? options.width ?? 0;
    segments.push(`rs:${resizeType}:${width}:${height}`);
    segments.push("dpr:2");
  } else {
    segments.push("dpr:2");
  }

  const path = `/${segments.join("/")}/${encodedUrl}`;
  const signature = signUrl(path, proxyConfig.key, proxyConfig.salt);

  return `${proxyConfig.url}/${signature}${path}`;
}
