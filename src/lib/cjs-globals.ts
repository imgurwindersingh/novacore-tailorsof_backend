// Top level var declarations so bare __filename and __dirname references never throw ReferenceError in ESM
// @ts-ignore
if (typeof __filename === "undefined") {
  // @ts-ignore
  var __filename = "/index.js";
}
// @ts-ignore
if (typeof __dirname === "undefined") {
  // @ts-ignore
  var __dirname = "/";
}

const g = globalThis as typeof globalThis & {
  __filename?: string;
  __dirname?: string;
};

if (typeof g.__filename === "undefined") {
  try {
    Object.defineProperty(g, "__filename", {
      value: "/index.js",
      writable: true,
      configurable: true,
    });
  } catch {
    g.__filename = "/index.js";
  }
}

if (typeof g.__dirname === "undefined") {
  try {
    Object.defineProperty(g, "__dirname", {
      value: "/",
      writable: true,
      configurable: true,
    });
  } catch {
    g.__dirname = "/";
  }
}

export {};
