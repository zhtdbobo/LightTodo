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

export const hasSelectedTextWithin = (
  element: HTMLElement,
  selection: Selection | null = window.getSelection()
) => {
  if (!selection || selection.isCollapsed || selection.toString().length === 0) {
    return false;
  }

  return (selection.anchorNode !== null && element.contains(selection.anchorNode))
    || (selection.focusNode !== null && element.contains(selection.focusNode));
};

export const hasExceededClickMovement = (
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  tolerance = 3
) => {
  const deltaX = currentX - startX;
  const deltaY = currentY - startY;

  return deltaX * deltaX + deltaY * deltaY > tolerance * tolerance;
};
