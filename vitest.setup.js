// Minimal browser globals so pdfjs-dist can load under Node for tests.
// DepoDesk only ever runs pdfjs in a real browser; text extraction needs
// none of these to actually work, but the module touches them at import
// time. Polyfilling here keeps the production module unchanged.

if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      const m = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0];
      [this.a, this.b, this.c, this.d, this.e, this.f] = m;
    }
    // pdfjs only inspects components for text-layer geometry.
    translate() { return this; }
    scale() { return this; }
    multiply() { return this; }
  };
}

if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(width, height) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); }
  };
}

if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} rect() {} quadraticCurveTo() {}
  };
}
