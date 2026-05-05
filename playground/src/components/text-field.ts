import type { ChangeEvent, InputHTMLAttributes, MouseEventHandler, ReactNode } from "react";

import type { DOMProps } from "./shared";

export type TextFieldSize = "small" | "medium" | "large";

/** TextField Component Props */
export interface TextFieldProps
  extends
    DOMProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "value" | "onChange" | "defaultValue"> {
  /**
   * Размер поля ввода.
   */
  size?: TextFieldSize;

  /**
   * Управляемое значение инпута. Если передано, компонент работает в контролируемом режиме (controlled).
   */
  value?: string;

  /**
   * Начальное значение инпута для неконтролируемого режима (uncontrolled). Если не передаётся `value`, используется
   * `defaultValue`.
   */
  defaultValue?: string;

  /**
   * Коллбэк, вызываемый при изменении текста в инпуте. Может принимать как событие, так и строковое значение.
   */
  onChange?: (value: string, evt: ChangeEvent<HTMLInputElement>) => void;

  /**
   * Текст для плейсхолдера.
   */
  placeholder?: string;

  /**
   * Включить возможность очистить значение инпута с помощью кнопки.
   *
   * @default false
   */
  enableClear?: boolean;

  /**
   * Обработчик нажатия клика по крестику очистки поля.
   */
  onClearClick?: MouseEventHandler<HTMLSpanElement>;

  /**
   * Дополнительный слот для кнопки справа.
   */
  endSlot?: ReactNode;

  /**
   * Дополнительный слот в правой части хинта. Используется для counter.
   */
  hintEndSlot?: ReactNode;
}
