// Floating "Translate this page" button. Creating an on-device model that still
// needs downloading requires transient user activation, so we surface a button and
// kick off translation from its click handler.

let button = null;

export function showActivationButton(onActivate) {
  if (button) return;
  button = document.createElement('button');
  button.className = 'tr-activate';
  button.type = 'button';
  button.textContent = 'Translate this page';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Preparing…';
    try {
      await onActivate((progress) => {
        button.textContent = `Downloading… ${Math.round(progress * 100)}%`;
      });
    } finally {
      hideActivationButton();
    }
  });
  document.documentElement.appendChild(button);
}

export function hideActivationButton() {
  if (button) {
    button.remove();
    button = null;
  }
}
