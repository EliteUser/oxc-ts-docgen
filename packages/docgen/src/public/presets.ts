export type DocgenPresetName = "typescript" | "react" | "dom";

export type DocgenPreset = {
  name: DocgenPresetName;
  ignoreTypes: readonly string[];
  displayAliases: readonly DocgenDisplayAlias[];
  semanticFallbackTypes: readonly string[];
  transparentTypes: readonly string[];
};

export type DocgenDisplayAlias = {
  name: string;
  displayName: string;
};

export const DEFAULT_PRESETS: readonly DocgenPresetName[] = ["typescript", "react", "dom"];

/**
 * TypeScript built-in utility types. Always safe to ignore — these are global compiler intrinsics
 * that cannot be resolved by reading source files.
 */
export const TYPESCRIPT_IGNORE_TYPES: readonly string[] = [
  "Omit",
  "Pick",
  "Partial",
  "Required",
  "Readonly",
  "Record",
  "Exclude",
  "Extract",
  "NonNullable",
  "ReturnType",
  "Parameters",
  "InstanceType",
  "ConstructorParameters",
  "ThisParameterType",
  "OmitThisParameter",
  "ThisType",
  "Awaited",
  "Promise",
  "PromiseLike",
  "Uppercase",
  "Lowercase",
  "Capitalize",
  "Uncapitalize",
  "NoInfer",
];

const TYPESCRIPT_SEMANTIC_FALLBACK_TYPES: readonly string[] = [];

const TYPESCRIPT_DISPLAY_ALIASES: readonly DocgenDisplayAlias[] = [];

const TYPESCRIPT_TRANSPARENT_TYPES: readonly string[] = [];
/**
 * React types that either expand into huge internal structures or are opaque runtime types. Keeps
 * the output focused on user-authored props.
 */
export const REACT_IGNORE_TYPES: readonly string[] = [
  // Nodes & elements
  "ReactNode",
  "ReactElement",
  "ReactFragment",
  "ReactPortal",
  "JSX.Element",
  "JSX.IntrinsicElements",
  // Component types
  "FC",
  "FunctionComponent",
  "Component",
  "PureComponent",
  "ComponentClass",
  "ComponentType",
  "LazyExoticComponent",
  "ExoticComponent",
  "NamedExoticComponent",
  "MemoExoticComponent",
  "ForwardRefExoticComponent",
  // Refs
  "Ref",
  "RefObject",
  "MutableRefObject",
  "ForwardedRef",
  "RefCallback",
  "LegacyRef",
  // Context / hooks
  "Context",
  "Dispatch",
  "SetStateAction",
  "Reducer",
  "ReducerState",
  "ReducerAction",
  // Props wrappers
  "PropsWithChildren",
  "PropsWithRef",
  "PropsWithoutRef",
  // Misc
  "Key",
  "CSSProperties",
  "ErrorInfo",
  "SuspenseProps",
  "StrictModeProps",
  "ProfilerProps",
  // Events (types)
  "SyntheticEvent",
  "ClipboardEvent",
  "CompositionEvent",
  "DragEvent",
  "FocusEvent",
  "FormEvent",
  "ChangeEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "TouchEvent",
  "TransitionEvent",
  "AnimationEvent",
  "WheelEvent",
  "UIEvent",
  "BaseSyntheticEvent",
  // Event handlers
  "EventHandler",
  "ReactEventHandler",
  "ClipboardEventHandler",
  "CompositionEventHandler",
  "DragEventHandler",
  "FocusEventHandler",
  "FormEventHandler",
  "ChangeEventHandler",
  "KeyboardEventHandler",
  "MouseEventHandler",
  "PointerEventHandler",
  "TouchEventHandler",
  "TransitionEventHandler",
  "AnimationEventHandler",
  "WheelEventHandler",
  "UIEventHandler",
];

const REACT_SEMANTIC_FALLBACK_TYPES: readonly string[] = [
  "ComponentProps",
  "ComponentPropsWithRef",
  "ComponentPropsWithoutRef",
  "CustomComponentPropsWithRef",
];

const REACT_TRANSPARENT_TYPES: readonly string[] = [
  "PropsWithChildren",
  "PropsWithRef",
  "PropsWithoutRef",
];

const uniquePresetValues = (values: readonly string[]): string[] => {
  return [...new Set(values)];
};

const expandReactQualifiedNames = (names: readonly string[]): string[] => {
  return uniquePresetValues(
    names.flatMap((name) => (name.includes(".") ? [name] : [name, `React.${name}`])),
  );
};

const createReactQualifiedDisplayAliases = (names: readonly string[]): DocgenDisplayAlias[] => {
  return names
    .filter((name) => !name.includes("."))
    .map((name) => ({ name: `React.${name}`, displayName: name }));
};

const REACT_DISPLAY_ALIASES: readonly DocgenDisplayAlias[] = [
  ...createReactQualifiedDisplayAliases(REACT_IGNORE_TYPES),
  ...createReactQualifiedDisplayAliases(REACT_SEMANTIC_FALLBACK_TYPES),
];

/**
 * HTML / DOM attribute interfaces from `@types/react`. Each of these expands into 50-200+ inherited
 * DOM properties that bury the component's own API.
 */
export const DOM_IGNORE_TYPES: readonly string[] = [
  // Generic
  "HTMLAttributes",
  "AllHTMLAttributes",
  "DOMAttributes",
  // "AriaAttributes",
  "SVGAttributes",
  // Per-element attribute interfaces
  "AnchorHTMLAttributes",
  "AreaHTMLAttributes",
  "AudioHTMLAttributes",
  "BaseHTMLAttributes",
  "BlockquoteHTMLAttributes",
  "ButtonHTMLAttributes",
  "CanvasHTMLAttributes",
  "ColHTMLAttributes",
  "ColgroupHTMLAttributes",
  "DataHTMLAttributes",
  "DetailsHTMLAttributes",
  "DelHTMLAttributes",
  "DialogHTMLAttributes",
  "EmbedHTMLAttributes",
  "FieldsetHTMLAttributes",
  "FormHTMLAttributes",
  "IframeHTMLAttributes",
  "ImgHTMLAttributes",
  "InputHTMLAttributes",
  "InsHTMLAttributes",
  "KeygenHTMLAttributes",
  "LabelHTMLAttributes",
  "LiHTMLAttributes",
  "LinkHTMLAttributes",
  "MapHTMLAttributes",
  "MenuHTMLAttributes",
  "MetaHTMLAttributes",
  "MeterHTMLAttributes",
  "ObjectHTMLAttributes",
  "OlHTMLAttributes",
  "OptgroupHTMLAttributes",
  "OptionHTMLAttributes",
  "OutputHTMLAttributes",
  "ParamHTMLAttributes",
  "ProgressHTMLAttributes",
  "QuoteHTMLAttributes",
  "ScriptHTMLAttributes",
  "SelectHTMLAttributes",
  "SlotHTMLAttributes",
  "SourceHTMLAttributes",
  "StyleHTMLAttributes",
  "TableHTMLAttributes",
  "TdHTMLAttributes",
  "TextareaHTMLAttributes",
  "ThHTMLAttributes",
  "TimeHTMLAttributes",
  "TrackHTMLAttributes",
  "VideoHTMLAttributes",
  "WebViewHTMLAttributes",
  // DOM element types
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLAnchorElement",
  "HTMLFormElement",
  "HTMLDivElement",
  "HTMLSpanElement",
  "HTMLImageElement",
  "HTMLTableElement",
  "HTMLCanvasElement",
  "HTMLVideoElement",
  "HTMLAudioElement",
  "EventTarget",
  "Node",
];

const DOM_SEMANTIC_FALLBACK_TYPES: readonly string[] = ["JSX.IntrinsicElements"];
const DOM_DISPLAY_ALIASES: readonly DocgenDisplayAlias[] =
  createReactQualifiedDisplayAliases(DOM_IGNORE_TYPES);
const DOM_TRANSPARENT_TYPES: readonly string[] = [];

export const TYPESCRIPT_PRESET: DocgenPreset = {
  name: "typescript",
  ignoreTypes: TYPESCRIPT_IGNORE_TYPES,
  displayAliases: TYPESCRIPT_DISPLAY_ALIASES,
  semanticFallbackTypes: TYPESCRIPT_SEMANTIC_FALLBACK_TYPES,
  transparentTypes: TYPESCRIPT_TRANSPARENT_TYPES,
};

export const REACT_PRESET: DocgenPreset = {
  name: "react",
  ignoreTypes: expandReactQualifiedNames(REACT_IGNORE_TYPES),
  displayAliases: REACT_DISPLAY_ALIASES,
  semanticFallbackTypes: expandReactQualifiedNames(REACT_SEMANTIC_FALLBACK_TYPES),
  transparentTypes: expandReactQualifiedNames(REACT_TRANSPARENT_TYPES),
};

export const DOM_PRESET: DocgenPreset = {
  name: "dom",
  ignoreTypes: expandReactQualifiedNames(DOM_IGNORE_TYPES),
  displayAliases: DOM_DISPLAY_ALIASES,
  semanticFallbackTypes: DOM_SEMANTIC_FALLBACK_TYPES,
  transparentTypes: DOM_TRANSPARENT_TYPES,
};

export const BUILTIN_PRESETS: Record<DocgenPresetName, DocgenPreset> = {
  typescript: TYPESCRIPT_PRESET,
  react: REACT_PRESET,
  dom: DOM_PRESET,
};

export const resolvePresetIgnoreTypes = (presets: readonly DocgenPresetName[]): string[] => {
  return uniquePresetValues(presets.flatMap((preset) => BUILTIN_PRESETS[preset].ignoreTypes));
};

export const resolvePresetDisplayAlias = (
  presets: readonly DocgenPresetName[],
  typeName: string,
): string => {
  for (const preset of presets) {
    const alias = BUILTIN_PRESETS[preset].displayAliases.find((item) => item.name === typeName);

    if (alias) {
      return alias.displayName;
    }
  }

  return typeName;
};

export const isDocgenPresetName = (value: string): value is DocgenPresetName => {
  return value === "typescript" || value === "react" || value === "dom";
};

export const isPresetSemanticFallbackType = (
  presets: readonly DocgenPresetName[],
  typeName: string,
): boolean => {
  return resolvePresetSemanticFallbackTypes(presets).includes(typeName);
};

export const resolvePresetTransparentTypes = (presets: readonly DocgenPresetName[]): string[] => {
  return uniquePresetValues(presets.flatMap((preset) => BUILTIN_PRESETS[preset].transparentTypes));
};

export const isPresetTransparentType = (
  presets: readonly DocgenPresetName[],
  typeName: string,
): boolean => {
  return resolvePresetTransparentTypes(presets).includes(typeName);
};

const resolvePresetSemanticFallbackTypes = (presets: readonly DocgenPresetName[]): string[] => {
  return uniquePresetValues(
    presets.flatMap((preset) => BUILTIN_PRESETS[preset].semanticFallbackTypes),
  );
};
