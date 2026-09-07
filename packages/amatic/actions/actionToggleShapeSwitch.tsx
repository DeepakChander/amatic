import { CaptureUpdateAction } from "@amatic/element";

import {
  getConversionTypeFromElements,
  convertElementTypePopupAtom,
} from "../components/ConvertElementTypePopup";
import { editorJotaiStore } from "../editor-jotai";

import { register } from "./register";

import type { ExcalidrawElement } from "@amatic/element";

export const actionToggleShapeSwitch = register({
  name: "toggleShapeSwitch",
  label: "labels.shapeSwitch",
  icon: () => null,
  viewMode: true,
  trackEvent: {
    category: "shape_switch",
    action: "toggle",
  },
  keywords: ["change", "switch", "swap"],
  perform(elements, appState, _, app) {
    editorJotaiStore.set(convertElementTypePopupAtom, {
      type: "panel",
    });

    return {
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  },
  checked: (appState) => appState.gridModeEnabled,
  predicate: (elements, appState, props) =>
    getConversionTypeFromElements(elements as ExcalidrawElement[]) !== null,
});
