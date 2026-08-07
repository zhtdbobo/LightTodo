const nativeContextMenuSelector = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  ".simple-markdown-preview",
].join(",");

export const shouldAllowNativeContextMenu = (target: EventTarget | null) => {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;

  return Boolean(element?.closest(nativeContextMenuSelector));
};

export const handleContextMenu = (event: MouseEvent) => {
  if (!shouldAllowNativeContextMenu(event.target)) {
    event.preventDefault();
  }
};
