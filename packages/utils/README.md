# @Amatic/utils

## Install

```bash
npm install @Amatic/utils
```

If you prefer Yarn over npm, use this command to install the Amatic utils package:

```bash
yarn add @Amatic/utils
```

## API

### `serializeAsJSON`

See [`serializeAsJSON`](https://github.com/Amatic/Amatic/blob/master/src/packages/Amatic/README.md#serializeAsJSON) for API and description.

### `exportToBlob` (async)

Export an Amatic diagram to a [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob).

### `exportToSvg`

Export an Amatic diagram to a [SVGElement](https://developer.mozilla.org/en-US/docs/Web/API/SVGElement).

## Usage

Amatic utils is published as a UMD (Universal Module Definition). If you are using a module bundler (for instance, Webpack), you can import it as an ES6 module:

```js
import { exportToSvg, exportToBlob } from "@Amatic/utils";
```

To use it in a browser directly:

```html
<script src="https://unpkg.com/@Amatic/utils@0.1.0/dist/Amatic-utils.min.js"></script>
<script>
  // AmaticUtils is a global variable defined by Amatic.min.js
  const { exportToSvg, exportToBlob } = AmaticUtils;
</script>
```

Here's the `exportToBlob` and `exportToSvg` functions in action:

```js
const AmaticDiagram = {
  type: "Amatic",
  version: 2,
  source: "https://Amatic.com",
  elements: [
    {
      id: "vWrqOAfkind2qcm7LDAGZ",
      type: "ellipse",
      x: 414,
      y: 237,
      width: 214,
      height: 214,
      angle: 0,
      strokeColor: "#000000",
      backgroundColor: "#15aabf",
      fillStyle: "hachure",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      roundness: null,
      seed: 1041657908,
      version: 120,
      versionNonce: 1188004276,
      isDeleted: false,
      boundElementIds: null,
    },
  ],
  appState: {
    viewBackgroundColor: "#ffffff",
    gridSize: null,
  },
};

// Export the Amatic diagram as SVG string
const svg = exportToSvg(AmaticDiagram);
console.log(svg.outerHTML);

// Export the Amatic diagram as PNG Blob URL
(async () => {
  const blob = await exportToBlob({
    ...AmaticDiagram,
    mimeType: "image/png",
  });

  const urlCreator = window.URL || window.webkitURL;
  console.log(urlCreator.createObjectURL(blob));
})();
```
