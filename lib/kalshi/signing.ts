import crypto from "crypto";

export function canonicalKalshiPath(baseUrl: string, endpointPath: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const endpoint = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  const url = new URL(`${base}${endpoint}`);
  return url.pathname;
}

export function kalshiSigningMessage(timestamp: string, method: string, path: string): string {
  return `${timestamp}${method.toUpperCase()}${path.split("?")[0]}`;
}

export function signKalshiRequest(input: {
  privateKeyPem: string;
  timestamp: string;
  method: string;
  path: string;
}): string {
  const message = kalshiSigningMessage(input.timestamp, input.method, input.path);
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), {
    key: input.privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  });
  return signature.toString("base64");
}
