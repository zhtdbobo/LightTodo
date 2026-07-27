const noteCreateButtonSelector = "[data-note-create-button]";

export const canClaimNoteFocus = (
  target: HTMLTextAreaElement,
  focusOrigin?: Element | null
) => {
  const activeElement = document.activeElement;

  return activeElement === null
    || activeElement === document.body
    || activeElement === target
    || activeElement === focusOrigin
    || (activeElement instanceof HTMLElement
      && Boolean(activeElement.closest(noteCreateButtonSelector)));
};
