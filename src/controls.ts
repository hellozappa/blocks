let labelId = 0;
export function labelWithoutTooltip(element: HTMLElement, text: string): void {
  const label = element.ownerDocument.createElement('span');
  label.id = `blocks-label-${++labelId}`;
  label.className = 'blocks-accessible-label';
  label.textContent = text;
  element.append(label);
  element.setAttribute('aria-labelledby', label.id);
}

export function createControlButton(document: Document, className: string, label: string, paths: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  // All SVG markup here is a fixed plugin constant.
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  labelWithoutTooltip(button, label);
  return button;
}

export function createControls(document: Document): { controls: HTMLElement; plus: HTMLButtonElement; handle: HTMLButtonElement } {
  const controls = document.createElement('div');
  controls.className = 'blocks-controls';
  controls.setAttribute('role', 'group');
  labelWithoutTooltip(controls, 'Block controls');
  const plus = createControlButton(document, 'blocks-plus', 'Insert block below. Option-click to insert above.', '<path d="M12 5v14M5 12h14"/>');
  const handle = createControlButton(document, 'blocks-handle', 'Select or drag block. Arrow keys move the block when this button has focus.', '<circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>');
  handle.setAttribute('aria-pressed', 'false');
  controls.append(plus, handle);
  return { controls, plus, handle };
}
