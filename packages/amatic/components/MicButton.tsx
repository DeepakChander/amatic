import clsx from "clsx";

import "./ToolIcon.scss";

import { microphoneIcon, microphoneMutedIcon } from "./icons";

import type { ToolButtonSize } from "./ToolButton";

type MicButtonProps = {
  title?: string;
  name?: string;
  checked: boolean;
  onChange?(): void;
  isMobile?: boolean;
};

const DEFAULT_SIZE: ToolButtonSize = "medium";

const ICONS = {
  CHECKED: microphoneIcon,
  UNCHECKED: microphoneMutedIcon,
};

export const MicButton = (props: MicButtonProps) => {
  return (
    <label
      className={clsx(
        "ToolIcon ToolIcon__mic",
        `ToolIcon_size_${DEFAULT_SIZE}`,
        {
          "is-mobile": props.isMobile,
        },
      )}
      title={props.title}
    >
      <input
        className="ToolIcon_type_checkbox"
        type="checkbox"
        name={props.name}
        onChange={props.onChange}
        checked={props.checked}
        aria-label={props.title}
        data-testid="toolbar-mic"
      />
      <div className="ToolIcon__icon">
        {props.checked ? ICONS.CHECKED : ICONS.UNCHECKED}
      </div>
    </label>
  );
};
